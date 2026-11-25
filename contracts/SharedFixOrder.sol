pragma solidity ^0.8.24;

interface IOrderToken {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address owner, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

contract SharedFixOrder {
    enum Status {
        Funding,
        Active,
        Reviewing,
        ChallengeWindow,
        PrimaryReview,
        BackupReview,
        Payable,
        Refundable
    }

    uint256 private constant MIN_ORDER = 10_000 * 1e6;
    uint256 private constant MIN_FEE = 500 * 1e6;

    IOrderToken public immutable token;
    address public immutable maintainer;
    address public immutable platform;
    address public immutable primary;
    address public immutable backup;
    uint64 public immutable fundingDeadline;
    uint64 public immutable deliveryPeriod;
    uint64 public immutable reviewPeriod;
    uint64 public immutable challengePeriod;
    uint64 public immutable refereePeriod;
    uint256 public immutable target;
    uint256 public immutable platformFee;
    bytes32 public immutable termsHash;

    address[3] public buyers;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public deposits;
    mapping(address => bool) public approved;
    mapping(address => bool) public claimed;
    uint256 public totalDeposited;
    uint8 public approvalCount;
    uint64 public deliveryDeadline;
    uint64 public reviewDeadline;
    uint64 public challengeDeadline;
    bytes32 public releaseHash;
    bytes32 public evidenceHash;
    bytes32 public challengeHash;

    Status private phase;
    uint64 private refereeStart;

    error InvalidParticipant();
    error InvalidToken();
    error InvalidShare();
    error InvalidPeriod();
    error InvalidHash();
    error IncorrectState();
    error Unauthorized();
    error AlreadyDeposited();
    error AlreadyApproved();
    error AlreadyClaimed();
    error NoEntitlement();
    error TokenTransferFailed();

    event Deposited(address indexed buyer, uint256 amount, uint256 total);
    event Activated(uint64 deliveryDeadline);
    event DeliverySubmitted(bytes32 indexed releaseHash, bytes32 evidenceHash, uint64 reviewDeadline);
    event DeliveryApproved(address indexed buyer, uint8 approvalCount);
    event ChallengeWindowOpened(uint64 challengeDeadline);
    event DeliveryChallenged(address indexed buyer, bytes32 reasonHash);
    event ReviewEscalated(uint64 primaryDeadline, uint64 finalDeadline);
    event RefereeDecision(address indexed referee, bool releasePayment);
    event Finalized(Status outcome);
    event Claimed(address indexed recipient, uint256 amount, bool refunded);

    constructor(
        address token_,
        address[3] memory buyers_,
        uint256[3] memory shares_,
        address maintainer_,
        address platform_,
        address primary_,
        address backup_,
        uint64 fundingPeriod_,
        uint64 deliveryPeriod_,
        uint64 reviewPeriod_,
        uint64 challengePeriod_,
        uint64 refereePeriod_,
        bytes32 termsHash_
    ) {
        if (token_.code.length == 0 || IOrderToken(token_).decimals() != 6) revert InvalidToken();
        if (termsHash_ == bytes32(0)) revert InvalidHash();
        _checkPeriod(fundingPeriod_);
        _checkPeriod(deliveryPeriod_);
        _checkPeriod(reviewPeriod_);
        _checkPeriod(challengePeriod_);
        _checkPeriod(refereePeriod_);
        _checkParticipants([buyers_[0], buyers_[1], buyers_[2], maintainer_, platform_, primary_, backup_], token_);

        token = IOrderToken(token_);
        buyers = buyers_;
        maintainer = maintainer_;
        platform = platform_;
        primary = primary_;
        backup = backup_;
        termsHash = termsHash_;
        fundingDeadline = uint64(block.timestamp) + fundingPeriod_;
        deliveryPeriod = deliveryPeriod_;
        reviewPeriod = reviewPeriod_;
        challengePeriod = challengePeriod_;
        refereePeriod = refereePeriod_;
        target = _recordShares(buyers_, shares_);
        platformFee = _calculateFee(target);
    }

    function deposit() external {
        if (status() != Status.Funding) revert IncorrectState();
        uint256 share = shares[msg.sender];
        if (share == 0) revert Unauthorized();
        if (deposits[msg.sender] != 0) revert AlreadyDeposited();

        uint256 previousBalance = token.balanceOf(address(this));
        deposits[msg.sender] = share;
        totalDeposited += share;
        bool activated = totalDeposited == target;
        if (activated) {
            deliveryDeadline = uint64(block.timestamp) + deliveryPeriod;
            phase = Status.Active;
        }

        if (!token.transferFrom(msg.sender, address(this), share)) revert TokenTransferFailed();
        if (token.balanceOf(address(this)) != previousBalance + share) revert TokenTransferFailed();

        emit Deposited(msg.sender, share, totalDeposited);
        if (activated) emit Activated(deliveryDeadline);
    }

    function submitDelivery(bytes32 releaseHash_, bytes32 evidenceHash_) external {
        if (msg.sender != maintainer) revert Unauthorized();
        if (status() != Status.Active) revert IncorrectState();
        if (releaseHash_ == bytes32(0) || evidenceHash_ == bytes32(0)) revert InvalidHash();

        releaseHash = releaseHash_;
        evidenceHash = evidenceHash_;
        reviewDeadline = uint64(block.timestamp) + reviewPeriod;
        phase = Status.Reviewing;
        emit DeliverySubmitted(releaseHash_, evidenceHash_, reviewDeadline);
    }

    function approveDelivery() external {
        if (shares[msg.sender] == 0) revert Unauthorized();
        if (status() != Status.Reviewing) revert IncorrectState();
        if (approved[msg.sender]) revert AlreadyApproved();

        approved[msg.sender] = true;
        approvalCount += 1;
        emit DeliveryApproved(msg.sender, approvalCount);
        if (approvalCount == 2) {
            challengeDeadline = uint64(block.timestamp) + challengePeriod;
            phase = Status.ChallengeWindow;
            emit ChallengeWindowOpened(challengeDeadline);
        }
    }

    function challenge(bytes32 reasonHash) external {
        if (shares[msg.sender] == 0) revert Unauthorized();
        if (status() != Status.ChallengeWindow) revert IncorrectState();
        if (reasonHash == bytes32(0)) revert InvalidHash();

        challengeHash = reasonHash;
        emit DeliveryChallenged(msg.sender, reasonHash);
        _startRefereeReview(uint64(block.timestamp));
    }

    function decide(bool releasePayment) external {
        Status current = status();
        if (current == Status.PrimaryReview) {
            if (msg.sender != primary) revert Unauthorized();
        } else if (current == Status.BackupReview) {
            if (msg.sender != backup) revert Unauthorized();
        } else {
            revert IncorrectState();
        }

        _recordApprovalTimeout();
        emit RefereeDecision(msg.sender, releasePayment);
        _setOutcome(releasePayment ? Status.Payable : Status.Refundable);
    }

    function finalize() external {
        Status current = status();
        if (current == Status.Payable || current == Status.Refundable) {
            _recordApprovalTimeout();
            _setOutcome(current);
        } else if (
            phase == Status.Reviewing &&
            (current == Status.PrimaryReview || current == Status.BackupReview)
        ) {
            _recordApprovalTimeout();
        } else {
            revert IncorrectState();
        }
    }

    function claim() external {
        if (claimed[msg.sender]) revert AlreadyClaimed();
        Status current = status();
        uint256 amount = _entitlement(msg.sender, current);
        if (amount == 0) revert NoEntitlement();

        _recordApprovalTimeout();
        _setOutcome(current);
        claimed[msg.sender] = true;
        if (!token.transfer(msg.sender, amount)) revert TokenTransferFailed();
        emit Claimed(msg.sender, amount, current == Status.Refundable);
    }

    function claimable(address account) external view returns (uint256) {
        if (claimed[account]) return 0;
        return _entitlement(account, status());
    }

    function status() public view returns (Status) {
        if (phase == Status.Funding && block.timestamp >= fundingDeadline) {
            return Status.Refundable;
        }
        if (phase == Status.Active && block.timestamp >= deliveryDeadline) {
            return Status.Refundable;
        }
        if (phase == Status.ChallengeWindow && block.timestamp >= challengeDeadline) {
            return Status.Payable;
        }

        uint64 reviewStart = _reviewStart();
        if (reviewStart == 0 || phase == Status.Payable || phase == Status.Refundable) {
            return phase;
        }
        if (block.timestamp < reviewStart + refereePeriod) return Status.PrimaryReview;
        if (block.timestamp < reviewStart + 2 * refereePeriod) return Status.BackupReview;
        return Status.Refundable;
    }

    function primaryDeadline() external view returns (uint64) {
        uint64 start = _reviewStart();
        return start == 0 ? 0 : start + refereePeriod;
    }

    function finalDeadline() external view returns (uint64) {
        uint64 start = _reviewStart();
        return start == 0 ? 0 : start + 2 * refereePeriod;
    }

    function _entitlement(address account, Status current) private view returns (uint256) {
        if (current == Status.Refundable) return deposits[account];
        if (current == Status.Payable) {
            if (account == maintainer) return target - platformFee;
            if (account == platform) return platformFee;
        }
        return 0;
    }

    function _setOutcome(Status outcome) private {
        if (phase == outcome) return;
        phase = outcome;
        emit Finalized(outcome);
    }

    function _reviewStart() private view returns (uint64) {
        if (refereeStart != 0) return refereeStart;
        if (phase == Status.Reviewing && block.timestamp >= reviewDeadline) return reviewDeadline;
        return 0;
    }

    function _recordApprovalTimeout() private {
        if (phase == Status.Reviewing) _startRefereeReview(reviewDeadline);
    }

    function _startRefereeReview(uint64 start) private {
        refereeStart = start;
        phase = Status.PrimaryReview;
        emit ReviewEscalated(start + refereePeriod, start + 2 * refereePeriod);
    }

    function _checkParticipants(address[7] memory participants, address token_) private pure {
        for (uint256 index = 0; index < participants.length; index++) {
            address participant = participants[index];
            if (participant == address(0) || participant == token_) revert InvalidParticipant();
            for (uint256 previous = 0; previous < index; previous++) {
                if (participant == participants[previous]) revert InvalidParticipant();
            }
        }
    }

    function _recordShares(address[3] memory buyers_, uint256[3] memory shares_) private returns (uint256 budget) {
        for (uint256 index = 0; index < buyers_.length; index++) {
            uint256 share = shares_[index];
            if (share == 0) revert InvalidShare();
            shares[buyers_[index]] = share;
            budget += share;
        }
        if (budget < MIN_ORDER) revert InvalidShare();
    }

    function _calculateFee(uint256 budget) private pure returns (uint256) {
        uint256 percentageFee = budget * 3 / 100;
        return percentageFee < MIN_FEE ? MIN_FEE : percentageFee;
    }

    function _checkPeriod(uint64 period) private pure {
        if (period == 0 || period > 365 days) revert InvalidPeriod();
    }
}

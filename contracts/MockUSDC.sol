pragma solidity ^0.8.24;

contract MockUSDC {
    string public constant name = "SharedFix Test USDC";
    string public constant symbol = "mUSDC";
    uint8 public constant decimals = 6;
    address public immutable issuer;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    error UnauthorizedIssuer();
    error InvalidAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        issuer = msg.sender;
    }

    function mint(address recipient, uint256 amount) external {
        if (msg.sender != issuer) revert UnauthorizedIssuer();
        if (recipient == address(0)) revert InvalidAddress();

        totalSupply += amount;
        balanceOf[recipient] += amount;
        emit Transfer(address(0), recipient, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert InvalidAddress();

        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address owner, address recipient, uint256 amount) external returns (bool) {
        uint256 approvedAmount = allowance[owner][msg.sender];
        if (approvedAmount != type(uint256).max) {
            if (approvedAmount < amount) revert InsufficientAllowance();
            allowance[owner][msg.sender] = approvedAmount - amount;
        }

        _transfer(owner, recipient, amount);
        return true;
    }

    function _transfer(address owner, address recipient, uint256 amount) private {
        if (owner == address(0) || recipient == address(0)) revert InvalidAddress();
        if (balanceOf[owner] < amount) revert InsufficientBalance();

        balanceOf[owner] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(owner, recipient, amount);
    }
}

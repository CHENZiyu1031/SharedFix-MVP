function createDemoEngine({ ethers, createProvider, orderArtifact, tokenArtifact, termsBytes, evidenceBytes }) {
  const { BrowserProvider, ContractFactory, id, keccak256, parseUnits, formatUnits, ZeroHash } = ethers;
  const decoder = new TextDecoder();
  const terms = JSON.parse(decoder.decode(termsBytes));
  const termsHash = keccak256(termsBytes);
  const evidenceHash = keccak256(evidenceBytes);
  const releaseHash = id(JSON.parse(decoder.decode(evidenceBytes)).release);
  const challengeHash = id('SharedFix example dispute: repeat the buyer wallet selection fixture');
  const chainId = 31337;
  const scenarioNames = ['success', 'refund', 'review'];
  const roleNames = ['A', 'B', 'C', 'maintainer', 'platform', 'primary', 'backup'];
  const roleLabels = ['Buyer A', 'Buyer B', 'Buyer C', 'Maintainer', 'SharedFix', 'Primary referee', 'Backup referee'];
  const statuses = ['Funding', 'Active', 'Reviewing', 'ChallengeWindow', 'PrimaryReview', 'BackupReview', 'Payable', 'Refundable'];
  const deadlineKeys = {
    Funding: 'fundingDeadline', Active: 'deliveryDeadline', Reviewing: 'reviewDeadline',
    ChallengeWindow: 'challengeDeadline', PrimaryReview: 'primaryDeadline', BackupReview: 'finalDeadline'
  };
  const customErrors = {
    AlreadyDeposited: 'This buyer already deposited its agreed share.',
    AlreadyApproved: 'This buyer already approved the submitted release.',
    AlreadyClaimed: 'Already claimed. The contract rejected the second withdrawal.',
    Unauthorized: 'This account is not authorized for that action.',
    IncorrectState: 'This action is unavailable at the current stage of the order.',
    NoEntitlement: 'This account has no payment or refund to claim.',
    TokenTransferFailed: 'The token transfer failed.'
  };
  const actionLabels = {
    deposit: 'Deposited', submit: 'Submitted release and evidence', approve: 'Approved delivery',
    challenge: 'Challenged delivery', claim: 'Claimed', accept: 'Authorized payment',
    reject: 'Authorized refunds', finalize: 'Recorded outcome', advance: 'Advanced the local clock'
  };

  const fromUnits = (value) => Number(formatUnits(value, 6));
  const toUnits = (value) => parseUnits(String(value), 6);
  const display = (amount) => Number(amount).toLocaleString('en-US');
  const hashOrEmpty = (value) => value === ZeroHash ? null : value;

  class DemoOrder {
    async initialize(index) {
      this.rpc = createProvider({
        chain: { chainId, hardfork: 'shanghai', time: new Date() },
        wallet: { deterministic: true, totalAccounts: 9 },
        miner: { timestampIncrement: 1 },
        logging: { quiet: true }
      });
      this.provider = new BrowserProvider(this.rpc, { name: 'sharedfix', chainId }, { cacheTimeout: -1 });
      const wallets = await Promise.all(Array.from({ length: 9 }, (_, account) => this.provider.getSigner(account)));
      this.organizer = wallets[0];
      this.roles = Object.fromEntries(roleNames.map((role, position) => [role, wallets[position + 1]]));
      const addresses = roleNames.map((role) => this.roles[role].address);
      const [maintainer, platform, primary, backup] = addresses.slice(3);
      const tokenFactory = new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, this.organizer);
      const orderFactory = new ContractFactory(orderArtifact.abi, orderArtifact.bytecode, this.organizer);
      this.token = await (await tokenFactory.deploy()).waitForDeployment();
      this.tokenAddress = await this.token.getAddress();
      for (let burn = 0; burn < index; burn += 1) {
        await (await this.organizer.sendTransaction({ to: this.organizer.address, value: 0 })).wait();
      }
      this.contract = await (await orderFactory.deploy(
        this.tokenAddress, addresses.slice(0, 3), terms.buyerShares.map(toUnits), maintainer, platform, primary, backup,
        terms.fundingPeriodSeconds, terms.deliveryPeriodSeconds, terms.reviewPeriodSeconds,
        terms.challengePeriodSeconds, terms.refereePeriodSecondsPerReferee, termsHash
      )).waitForDeployment();
      this.address = await this.contract.getAddress();
      this.receipts = [];
      for (const [index, role] of roleNames.slice(0, 3).entries()) {
        const wallet = this.roles[role];
        await (await this.token.mint(wallet.address, toUnits(terms.buyerShares[index]))).wait();
        await (await this.token.connect(wallet).approve(this.address, toUnits(terms.buyerShares[index]))).wait();
      }
    }

    async latestBlock() {
      return this.rpc.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
    }

    async snapshot() {
      const [block, status, funded, target, escrow, approvalCount, events, participants, funding, delivery,
        review, challenge, primary, final, release, evidence, challengeEvidence] = await Promise.all([
        this.latestBlock(), this.contract.status(), this.contract.totalDeposited(), this.contract.getFunction('target')(), this.token.balanceOf(this.address),
        this.contract.approvalCount(), Promise.resolve([...this.receipts]),
        Promise.all(roleNames.map(async (key, index) => {
          const address = this.roles[key].address;
          const [share, deposit, balance, claimable, claimed, approved] = await Promise.all([
            this.contract.shares(address), this.contract.deposits(address), this.token.balanceOf(address),
            this.contract.claimable(address), this.contract.claimed(address), this.contract.approved(address)
          ]);
          return { id: key, name: roleLabels[index], address, share: fromUnits(share), deposit: fromUnits(deposit),
            balance: fromUnits(balance), claimable: fromUnits(claimable), claimed, approved };
        })),
        this.contract.fundingDeadline(), this.contract.deliveryDeadline(), this.contract.reviewDeadline(),
        this.contract.challengeDeadline(), this.contract.primaryDeadline(), this.contract.finalDeadline(),
        this.contract.releaseHash(), this.contract.evidenceHash(), this.contract.challengeHash()
      ]);
      return { address: this.address, now: Number(block.timestamp), status: statuses[Number(status)], funded: fromUnits(funded),
        target: fromUnits(target), escrow: fromUnits(escrow), approvalCount: Number(approvalCount),
        deadlines: Object.fromEntries(Object.entries({ funding, delivery, review, challenge, primary, final }).map(([key, value]) => [key, Number(value)])),
        releaseHash: hashOrEmpty(release), evidenceHash: hashOrEmpty(evidence), challengeHash: hashOrEmpty(challengeEvidence),
        participants, receipts: events };
    }

    async advance() {
      const status = statuses[Number(await this.contract.status())];
      const deadlineKey = deadlineKeys[status];
      if (!deadlineKey) return { ok: false, message: 'This order has reached an outcome. No further deadline remains.' };
      const deadline = Number(await this.contract[deadlineKey]());
      await this.rpc.request({ method: 'evm_mine', params: [deadline + 1] });
      const block = await this.latestBlock();
      const timestamp = Number(block.timestamp);
      if (timestamp <= deadline) throw new Error('The local chain did not advance to the requested deadline.');
      const newStatus = statuses[Number(await this.contract.status())];
      return { ok: true, message: `Local test clock advanced past the ${status === 'Funding' ? 'funding' : status === 'Reviewing' ? 'review' : status === 'ChallengeWindow' ? 'challenge' : 'current'} deadline. Status: ${newStatus}.`,
        blockNumber: Number(block.number), timestamp };
    }

    async execute(action, role) {
      if (action === 'advance') return this.advance();
      const operations = {
        deposit: ['deposit', []], submit: ['submitDelivery', [releaseHash, evidenceHash]], approve: ['approveDelivery', []],
        challenge: ['challenge', [challengeHash]], claim: ['claim', []], accept: ['decide', [true]],
        reject: ['decide', [false]], finalize: ['finalize', []]
      };
      if (!Object.hasOwn(operations, action) || (action !== 'finalize' && !Object.hasOwn(this.roles, role))) {
        return { ok: false, message: 'Choose a valid action and a named test account.' };
      }
      const signer = action === 'finalize' ? this.organizer : this.roles[role];
      const [method, args] = operations[action];
      const call = this.contract.connect(signer)[method];
      let previewError;
      try {
        await call.staticCall(...args);
      } catch (error) {
        previewError = error;
      }
      let message = `${actionLabels[action]}.`;
      if (action === 'claim') message = `Claimed ${display(fromUnits(await this.contract.claimable(signer.address)))} test USDC.`;
      if (action === 'deposit') message = `Deposited ${display(fromUnits(await this.contract.shares(signer.address)))} test USDC.`;
      try {
        const tx = await call(...args, { gasLimit: 400_000 });
        const receipt = await tx.wait();
        const block = await this.latestBlock();
        return { ok: true, message, txHash: tx.hash, blockNumber: receipt.blockNumber, timestamp: Number(block.timestamp) };
      } catch (error) {
        const previewName = previewError?.revert?.name;
        message = customErrors[previewName] || 'Transaction reverted. The contract balance and entitlements did not change.';
        return { ok: false, message, errorCode: previewName || 'TransactionReverted', txHash: error.receipt?.hash,
          blockNumber: error.receipt?.blockNumber, timestamp: Number((await this.latestBlock()).timestamp) };
      }
    }
  }

  class SharedFixDemo {
    async reset() {
      if (this.scenarios) await Promise.all(Object.values(this.scenarios).map((order) => order.rpc.disconnect()));
      this.activeScenario = 'success';
      this.lastResult = null;
      this.scenarios = Object.fromEntries(scenarioNames.map((name) => [name, new DemoOrder()]));
      await Promise.all(scenarioNames.map((name, index) => this.scenarios[name].initialize(index)));
    }

    async snapshot() {
      const active = this.scenarios[this.activeScenario];
      const [block, orders] = await Promise.all([
        active.latestBlock(), Promise.all(scenarioNames.map(async (name) => [name, await this.scenarios[name].snapshot()]))
      ]);
      return { chainId, chainName: 'SharedFix local EVM', now: Number(block.timestamp), tokenAddress: active.tokenAddress,
        termsHash, activeScenario: this.activeScenario, scenarios: Object.fromEntries(orders), lastResult: this.lastResult };
    }

    async action(scenario, action, role) {
      if (action === 'reset') {
        await this.reset();
        this.lastResult = { ok: true, action, message: 'Started three new local orders.' };
      } else if (scenarioNames.includes(scenario)) {
        this.activeScenario = scenario;
        if (action === 'select') {
          this.lastResult = null;
        } else {
          const order = this.scenarios[scenario];
          const result = await order.execute(action, role);
          this.lastResult = { ...result, scenario, action, role: role || 'clock' };
          order.receipts.unshift(this.lastResult);
        }
      } else {
        this.lastResult = { ok: false, message: 'Choose a demonstration order.' };
      }
      return this.snapshot();
    }

    async close() {
      if (this.scenarios) await Promise.all(Object.values(this.scenarios).map((order) => order.rpc.disconnect()));
    }
  }
  return SharedFixDemo;
}

if (typeof module === 'object') module.exports = { createDemoEngine };

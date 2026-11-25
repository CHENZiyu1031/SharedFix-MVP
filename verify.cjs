const assert = require('node:assert/strict');
const { SharedFixDemo } = require('./engine.cjs');

async function verify() {
  const demo = new SharedFixDemo();
  await demo.reset();
  try {
    const step = async (scenario, action, role, expectOk = true) => {
      const state = await demo.action(scenario, action, role);
      assert.equal(state.lastResult.ok, expectOk, JSON.stringify(state.lastResult));
      if (action !== 'advance') assert.match(state.lastResult.txHash, /^0x[0-9a-f]{64}$/i);
      return state.scenarios[scenario];
    };
    const role = (order, id) => order.participants.find((item) => item.id === id);
    await step('success', 'deposit', 'A');
    const seven = await step('success', 'deposit', 'B');
    assert.equal(seven.funded, 7000);
    assert.equal(seven.status, 'Funding');
    const full = await step('success', 'deposit', 'C');
    assert.equal(full.funded, 10000);
    assert.equal(full.status, 'Active');
    await step('success', 'submit', 'maintainer');
    await step('success', 'approve', 'A');
    await step('success', 'approve', 'A', false);
    assert.equal((await step('success', 'approve', 'B')).status, 'ChallengeWindow');
    await step('success', 'claim', 'maintainer', false);
    assert.equal((await step('success', 'advance')).status, 'Payable');
    await step('success', 'claim', 'maintainer');
    const settled = await step('success', 'claim', 'platform');
    assert.equal(settled.escrow, 0);
    assert.equal(role(settled, 'maintainer').balance, 9500);
    assert.equal(role(settled, 'platform').balance, 500);
    console.log('PASS: 10,000 activates only after all deposits; two approvals; no early payout; 9,500 / 500 settlement.');

    await step('refund', 'deposit', 'A');
    await step('refund', 'deposit', 'B');
    assert.equal((await step('refund', 'advance')).status, 'Refundable');
    await step('refund', 'deposit', 'C', false);
    const refund = await step('refund', 'claim', 'A');
    assert.equal(role(refund, 'A').balance, 4000);
    const duplicate = await step('refund', 'claim', 'A', false);
    assert.equal(duplicate.escrow, 3000);
    assert.equal(role(duplicate, 'A').balance, 4000);
    const refunded = await step('refund', 'claim', 'B');
    assert.equal(role(refunded, 'B').balance, 3000);
    assert.equal(refunded.escrow, 0);
    console.log('PASS: expiring at 7,000 opens original deposits only; duplicate withdrawal reverts on the EVM.');

    for (const buyer of ['A', 'B', 'C']) await step('review', 'deposit', buyer);
    await step('review', 'submit', 'maintainer');
    assert.equal((await step('review', 'advance')).status, 'PrimaryReview');
    await step('review', 'accept', 'backup', false);
    assert.equal((await step('review', 'advance')).status, 'BackupReview');
    await step('review', 'accept', 'primary', false);
    assert.equal((await step('review', 'reject', 'backup')).status, 'Refundable');
    console.log('PASS: review silence advances to primary then backup referee; only the active referee can decide.');

    await demo.reset();
    for (const buyer of ['A', 'B', 'C']) await step('review', 'deposit', buyer);
    await step('review', 'submit', 'maintainer');
    await step('review', 'approve', 'A');
    await step('review', 'approve', 'B');
    assert.equal((await step('review', 'challenge', 'C')).status, 'PrimaryReview');
    await step('review', 'advance');
    const silent = await step('review', 'advance');
    assert.equal(silent.status, 'Refundable');
    assert.equal(role(silent, 'C').claimable, 3000);
    console.log('PASS: buyer challenge freezes payment; silence at both referee deadlines opens full refunds.');
  } finally {
    await demo.close();
  }
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

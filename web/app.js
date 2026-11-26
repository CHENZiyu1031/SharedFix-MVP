const scenarioList = [
  { id: 'success', tab: 'Fund & settle', title: 'All three buyers commit', summary: 'Each buyer contributes its agreed share. Payment becomes available after review and the challenge period.' },
  { id: 'refund', tab: 'Expire & refund', title: 'The third buyer does not pay', summary: 'The order stops at 7,000. At expiry, the two buyers can reclaim their own deposits once each.' },
  { id: 'review', tab: 'Independent review', title: 'Refer a delivery for review', summary: 'A reviewer timeout or a buyer challenge sends the delivery to the named referee. The referee can approve payment or open refunds.' },
];

const statusLabels = {
  Funding: 'Awaiting deposits', Active: 'Order active', Reviewing: 'Buyer review', ChallengeWindow: 'Challenge period',
  PrimaryReview: 'Primary referee', BackupReview: 'Backup referee', Payable: 'Payment available', Refundable: 'Refund available',
  Settled: 'Settled', Refunded: 'Refunds complete',
};

const statusColors = { Active: 'success', Payable: 'success', Settled: 'success', Refunded: 'success', ChallengeWindow: 'warning', PrimaryReview: 'warning', BackupReview: 'warning', Refundable: 'warning' };
const roles = ['A', 'B', 'C'];
const numbers = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const element = (id) => document.getElementById(id);
const money = (value) => numbers.format(Number(value ?? 0));
const shortened = (value) => value && value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value;

const demoClient = createDemoClient();

let snapshot = null;
let scenarioId = 'success';
let reviewPath = 'timeout';
let busy = false;
let connected = false;
let message = null;

function make(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

function command(label, action, role) {
  return { label, action, role };
}

function phase(label, done, next, extras = []) {
  return { label, done, next, extras };
}

function participant(order, id) {
  return order.participants.find((item) => item.id === id);
}

function receiptFor(order, action, role, ok = true) {
  return order.receipts.some((receipt) => receipt.action === action && receipt.role === role && receipt.ok === ok);
}

function fundPhase(order, buyerIds, label) {
  const buyer = buyerIds.map((id) => participant(order, id)).find((item) => item && item.deposit < item.share);
  return phase(label, !buyer, buyer && command(`Deposit ${money(buyer.share)} as ${buyer.id}`, 'deposit', buyer.id));
}

function deliveryPhase(order) {
  return phase('Submit release evidence', order.status !== 'Active' && order.status !== 'Funding', command('Submit delivery as maintainer', 'submit', 'maintainer'));
}

function approvalsPhase(order) {
  const buyer = roles.map((id) => participant(order, id)).find((item) => item && !item.approved);
  return phase('Record two buyer approvals', order.approvalCount >= 2, buyer && command(`Approve as buyer ${buyer.id}`, 'approve', buyer.id));
}

function settledPhase(order) {
  const maintainer = participant(order, 'maintainer');
  const platform = participant(order, 'platform');
  const next = !maintainer.claimed ? command('Pay maintainer 9,500', 'claim', 'maintainer') : command('Pay platform 500', 'claim', 'platform');
  return phase('Settle 9,500 to the maintainer and 500 to SharedFix', maintainer.claimed && platform.claimed, next);
}

function refundPhase(order) {
  const buyer = roles.map((id) => participant(order, id)).find((item) => item && item.deposit > 0 && !item.claimed);
  return phase('Return deposits to the original wallets', !buyer, buyer && command(`Refund buyer ${buyer.id} ${money(buyer.claimable || buyer.deposit)}`, 'claim', buyer.id));
}

function demoPhases(order) {
  if (scenarioId === 'success') {
    return [
      fundPhase(order, roles, 'Fund the 10,000 order'),
      deliveryPhase(order),
      approvalsPhase(order),
      phase('Allow the challenge period to end', order.status === 'Payable', command('Advance past challenge period', 'advance')),
      settledPhase(order),
    ];
  }
  if (scenarioId === 'refund') {
    const buyerA = participant(order, 'A');
    const buyerB = participant(order, 'B');
    return [
      fundPhase(order, ['A', 'B'], 'Stop funding at 7,000'),
      phase('Let the funding deadline pass', order.status === 'Refundable', command('Advance past funding deadline', 'advance')),
      phase('Return 4,000 to buyer A', buyerA.claimed, command('Refund buyer A 4,000', 'claim', 'A')),
      phase('Confirm a second refund is rejected', receiptFor(order, 'claim', 'A', false), command('Try A’s refund again', 'claim', 'A')),
      phase('Return 3,000 to buyer B', buyerB.claimed, command('Refund buyer B 3,000', 'claim', 'B')),
    ];
  }

  const challengePath = reviewPath === 'challenge' || order.approvalCount > 0;
  const referred = ['PrimaryReview', 'BackupReview', 'Payable', 'Refundable'].includes(order.status);
  const decided = ['Payable', 'Refundable'].includes(order.status);
  const referee = order.status === 'BackupReview' ? 'backup' : 'primary';
  const steps = [fundPhase(order, roles, 'Fund the 10,000 order'), deliveryPhase(order)];
  if (challengePath) {
    steps.push(approvalsPhase(order));
    steps.push(phase('Record buyer C’s challenge', referred, command('Challenge as buyer C', 'challenge', 'C')));
  } else {
    steps.push(phase('Refer the order when approvals time out', referred, command('Advance past approval deadline', 'advance')));
  }
  steps.push(phase('Resolve the order by independent review', decided, command(`Accept as ${referee} referee`, 'accept', referee), [
    command(`Reject as ${referee} referee`, 'reject', referee),
    command(referee === 'primary' ? 'Skip to backup referee' : 'Advance to final refund deadline', 'advance'),
  ]));
  if (order.status === 'Refundable') {
    steps.push(refundPhase(order));
  } else {
    steps.push(settledPhase(order));
  }
  return steps;
}

function renderNavigation() {
  const buttons = scenarioList.map((item) => {
    const button = make('button', 'scenario-option', item.tab);
    button.type = 'button';
    button.disabled = busy;
    button.setAttribute('aria-pressed', item.id === scenarioId);
    button.addEventListener('click', () => {
      scenarioId = item.id;
      message = null;
      render();
      element('scenarios').querySelector('[aria-pressed="true"]')?.focus();
    });
    return button;
  });
  element('scenarios').replaceChildren(...buttons);
}

function renderOrder(order) {
  let status = order.status;
  if (status === 'Payable' && order.escrow === 0) status = 'Settled';
  if (status === 'Refundable' && order.escrow === 0) status = 'Refunded';
  const statusText = element('order-state');
  statusText.textContent = statusLabels[status] || status;
  statusText.className = `status-pill ${statusColors[status] || ''}`;
  element('order-title').textContent = shortened(order.address) || 'Order status';
  element('order-title').title = order.address || '';
  element('funded').textContent = money(order.funded);
  element('target').textContent = money(order.target);
  element('escrow-balance').textContent = `${money(order.escrow)} USDC`;
  element('approvals').textContent = `${order.approvalCount} / 2`;
  element('deadline').textContent = order.funded >= order.target ? 'Met' : order.deadlines.funding <= (order.now ?? snapshot.now) ? 'Passed' : 'Open';
  element('deadline').title = order.deadlines.funding ? new Date(order.deadlines.funding * 1000).toISOString() : '';
  const track = element('funding-track');
  track.setAttribute('aria-valuemax', order.target);
  track.setAttribute('aria-valuenow', order.funded);

  const rows = roles.map((id, index) => {
    const buyer = participant(order, id);
    const paid = buyer.claimed && order.status === 'Refundable';
    track.children[index].style.flexBasis = `${100 * buyer.deposit / order.target}%`;
    const row = make('tr');
    const nameCell = make('td');
    const name = make('span', 'buyer-name');
    name.textContent = buyer.name || `Buyer ${id}`;
    name.title = buyer.address || '';
    nameCell.append(name);
    row.append(nameCell, make('td', '', money(buyer.share)), make('td', paid ? 'refunded-cell' : buyer.deposit ? 'funded-cell' : '', paid ? `${money(buyer.deposit)} returned` : money(buyer.deposit)), make('td', '', money(buyer.balance)));
    return row;
  });
  element('buyers').replaceChildren(...rows);

  const settlement = element('settlement');
  settlement.hidden = !['Payable', 'PrimaryReview', 'BackupReview'].includes(order.status);
  if (!settlement.hidden) {
    if (order.status === 'Payable') {
      const outcomes = ['maintainer', 'platform'].map((role) => {
        const actor = participant(order, role);
        const item = make('span', 'contract-detail');
        const label = role === 'maintainer' ? 'Maintainer' : 'SharedFix';
        const amount = actor.claimed ? `${money(actor.balance)} received` : `${money(actor.claimable)} claimable`;
        item.append(`${label} `, make('strong', '', amount));
        return item;
      });
      settlement.replaceChildren(...outcomes);
    } else {
      const referee = participant(order, order.status === 'PrimaryReview' ? 'primary' : 'backup');
      settlement.replaceChildren(make('strong', '', 'Independent referee'), make('span', 'contract-detail', shortened(referee.address)));
      settlement.lastElementChild.title = referee.address;
    }
  }
}

function renderPhases(order) {
  const definition = scenarioList.find((item) => item.id === scenarioId);
  element('scenario-title').textContent = definition.title;
  element('scenario-summary').textContent = definition.summary;
  const phases = demoPhases(order);
  const current = phases.findIndex((item) => !item.done);
  const list = phases.map((item, index) => {
    const row = make('li', `step${index === current ? ' current' : item.done ? ' done' : ''}`);
    if (index === current) row.setAttribute('aria-current', 'step');
    const marker = make('span', 'step-marker', item.done ? '✓' : index + 1);
    marker.setAttribute('aria-hidden', 'true');
    row.append(marker, make('span', '', item.label));
    return row;
  });
  element('steps').replaceChildren(...list);
  const selected = current < 0 ? null : phases[current];
  const button = element('next');
  button.textContent = busy ? 'Waiting for local chain…' : selected?.next?.label || 'Scenario complete';
  button.disabled = busy || !selected?.next;
  button.onclick = selected?.next ? () => run(selected.next) : null;
  const extras = [...(selected?.extras ?? [])];
  if (scenarioId === 'review' && order.approvalCount === 0 && ['Funding', 'Active', 'Reviewing'].includes(order.status)) {
    extras.push(command(reviewPath === 'challenge' ? 'Use approval timeout' : 'Use buyer challenge', 'switch-review'));
  }
  const extraNodes = extras.map((action) => {
    const extraButton = make('button', 'quiet-button', action.label);
    extraButton.type = 'button';
    extraButton.disabled = busy;
    extraButton.onclick = () => run(action);
    return extraButton;
  });
  element('extra-actions').replaceChildren(...extraNodes);
  element('reset').disabled = busy;

  const note = element('action-message');
  note.textContent = message?.text || '';
  note.className = `action-message ${message?.kind || ''}`;
}

function renderReceipts(order) {
  const list = element('receipts');
  element('receipt-note').textContent = `Chain ${snapshot.chainId} · Local transaction log`;
  const receipts = order.receipts;
  if (!receipts.length) {
    list.replaceChildren(make('p', 'no-receipts', 'Order ready. The first buyer deposit will appear here.'));
    return;
  }
  const rows = receipts.map((receipt) => {
    const details = make('details', 'receipt-row');
    const summary = make('summary');
    const advanced = receipt.action === 'advance' && receipt.ok;
    const kind = advanced ? 'Demo time' : receipt.ok ? 'Confirmed' : receipt.txHash ? 'Reverted' : 'Rejected';
    const style = advanced ? 'clock' : receipt.ok ? '' : 'reverted';
    const headline = receipt.message || (receipt.role ? `${receipt.action} by ${receipt.role}` : receipt.action);
    summary.append(make('span', 'receipt-label', headline), make('span', `receipt-kind ${style}`, kind), make('span', 'receipt-hash', shortened(receipt.txHash) || (advanced ? 'Local clock' : '')));
    const detail = make('div', 'receipt-detail');
    if (receipt.txHash) detail.append(make('code', '', receipt.txHash));
    if (receipt.blockNumber != null) detail.append(make('span', '', `Block ${receipt.blockNumber}`));
    if (advanced) detail.append(make('span', '', 'The demonstration advanced the local chain clock.'));
    if (!detail.childNodes.length) detail.append(make('span', '', 'No transaction hash returned.'));
    details.append(summary, detail);
    return details;
  });
  list.replaceChildren(...rows);
}

function render() {
  renderNavigation();
  if (!snapshot?.scenarios?.[scenarioId]) return;
  const order = snapshot.scenarios[scenarioId];
  element('network-label').textContent = connected ? demoClient.readyLabel : demoClient.errorLabel;
  element('network-light').className = `network-light ${connected ? 'online' : 'offline'}`;
  renderOrder(order);
  renderPhases(order);
  renderReceipts(order);
}

async function run(item) {
  if (busy) return;
  if (item.action === 'switch-review') {
    reviewPath = reviewPath === 'timeout' ? 'challenge' : 'timeout';
    message = null;
    render();
    return;
  }
  const expectedRejection = scenarioId === 'refund' && item.action === 'claim' && item.role === 'A' && participant(snapshot.scenarios.refund, 'A').claimed;
  busy = true;
  message = null;
  render();
  try {
    const result = await demoClient.action(scenarioId, item.action, item.role);
    snapshot = result;
    connected = true;
    const latest = result.lastResult;
    if (item.action === 'reset') {
      reviewPath = 'timeout';
      message = { text: 'Fresh test orders are ready.', kind: 'success' };
    } else if (expectedRejection && latest?.ok === false) {
      message = { text: 'Duplicate refund rejected. Buyer A kept the original refund.', kind: 'success' };
    } else if (latest) {
      message = { text: latest.message, kind: latest.ok ? 'success' : 'error' };
    }
  } catch (error) {
    message = { text: error.message || 'The test chain did not respond. Try again.', kind: 'error' };
    try {
      snapshot = await demoClient.snapshot();
      connected = true;
    } catch {
      connected = false;
    }
  } finally {
    busy = false;
    render();
    element('next').focus();
  }
}

async function load() {
  element('next').disabled = true;
  try {
    snapshot = await demoClient.start();
    connected = true;
    scenarioId = scenarioList.some((item) => item.id === snapshot.activeScenario) ? snapshot.activeScenario : 'success';
    element('reset').onclick = () => run(command('Reset demo', 'reset'));
    render();
  } catch (error) {
    console.error('SharedFix could not start the demo.', error);
    connected = false;
    element('network-label').textContent = demoClient.errorLabel;
    element('network-light').className = 'network-light offline';
    element('order-state').textContent = 'Offline';
    element('scenario-summary').textContent = demoClient.retryMessage;
    element('next').textContent = 'Retry connection';
    element('next').disabled = false;
    element('next').onclick = load;
  }
}

load();

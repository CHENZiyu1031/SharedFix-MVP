function createDemoClient() {
  async function request(path, data) {
    const response = await fetch(path, data ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    } : { cache: 'no-store' });
    const result = await response.json();
    if (!result?.scenarios) throw new Error(result?.message || result?.error || `Local server returned ${response.status}`);
    return result;
  }

  const snapshot = () => request('/api/state');
  return {
    readyLabel: 'Local EVM',
    errorLabel: 'Local server unavailable',
    retryMessage: 'Start the SharedFix local demo and open its local address.',
    start: snapshot,
    snapshot,
    action: (scenario, action, role) => request('/api/action', { scenario, action, role })
  };
}

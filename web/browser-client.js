function createDemoClient() {
  let worker;
  let pending;

  function request(method, args = []) {
    return new Promise((resolve, reject) => {
      if (pending) throw new Error('Wait for the current test chain action to finish.');
      if (!worker) {
        if (method !== 'start') throw new Error('Reload the page to start a new test chain.');
        worker = new Worker('./demo-worker.js');
        worker.onmessage = ({ data }) => {
          const current = pending;
          if (!current) return;
          pending = null;
          if (data.error) {
            if (current.method === 'start') {
              worker.terminate();
              worker = null;
            }
            current.reject(new Error(data.error));
          } else {
            current.resolve(data.result);
          }
        };
        worker.onerror = (event) => {
          worker.terminate();
          worker = null;
          const current = pending;
          pending = null;
          current?.reject(new Error(event.message || 'Failed to start the browser test chain.'));
        };
      }
      pending = { method, resolve, reject };
      worker.postMessage({ method, args });
    });
  }

  return {
    readyLabel: 'Browser EVM',
    errorLabel: 'Test chain unavailable',
    retryMessage: 'The browser could not start its test chain. Try again.',
    start: () => request('start'),
    snapshot: () => request('snapshot'),
    action: (scenario, action, role) => request('action', [scenario, action, role])
  };
}

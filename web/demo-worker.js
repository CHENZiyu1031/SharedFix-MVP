importScripts('./ethers.umd.min.js', './ganache.min.js', './demo-engine.js');

let demo;

async function loadAsset(name) {
  const response = await fetch(new URL(name, self.location.href));
  if (!response.ok) throw new Error(`Could not load ${name}.`);
  return response;
}

async function start() {
  const [orderArtifact, tokenArtifact, termsBytes, evidenceBytes] = await Promise.all([
    loadAsset('SharedFixOrder.json').then((response) => response.json()),
    loadAsset('MockUSDC.json').then((response) => response.json()),
    loadAsset('order-terms.json').then(async (response) => new Uint8Array(await response.arrayBuffer())),
    loadAsset('example-delivery.json').then(async (response) => new Uint8Array(await response.arrayBuffer()))
  ]);
  const SharedFixDemo = createDemoEngine({
    ethers: self.ethers,
    createProvider: (options) => self.Ganache.provider(options),
    orderArtifact,
    tokenArtifact,
    termsBytes,
    evidenceBytes
  });
  await demo?.close();
  demo = new SharedFixDemo();
  await demo.reset();
  return demo.snapshot();
}

self.onmessage = async ({ data: { method, args } }) => {
  try {
    const result = method === 'start' ? await start() : await demo[method](...args);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};

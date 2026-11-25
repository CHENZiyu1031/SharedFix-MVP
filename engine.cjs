const fs = require('node:fs');
const path = require('node:path');
const ethers = require('ethers');
const { createDemoEngine } = require('./demo-engine.js');
process.env.UWS_USE_FALLBACK = 'true';
const ganache = require('ganache');

const SharedFixDemo = createDemoEngine({
  ethers,
  createProvider: (options) => ganache.provider(options),
  orderArtifact: require('./artifacts/SharedFixOrder.json'),
  tokenArtifact: require('./artifacts/MockUSDC.json'),
  termsBytes: fs.readFileSync(path.join(__dirname, 'docs', 'order-terms.json')),
  evidenceBytes: fs.readFileSync(path.join(__dirname, 'docs', 'example-delivery.json'))
});

module.exports = { SharedFixDemo };

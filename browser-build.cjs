const fs = require('node:fs');
const path = require('node:path');

const { createHash } = require('node:crypto');

const root = __dirname;
const output = path.join(root, 'dist');
const ganache = path.dirname(require.resolve('ganache/package.json'));
const ethers = path.join(path.dirname(require.resolve('ethers')), '../dist');
const files = {
  'dm-sans-latin.woff2': 'web/dm-sans-latin.woff2',
  'dm-sans-LICENSE.txt': 'web/dm-sans-LICENSE.txt',
  'styles.css': 'web/styles.css',
  'app.js': 'web/app.js',
  'demo-client.js': 'web/browser-client.js',
  'demo-worker.js': 'web/demo-worker.js',
  'demo-engine.js': 'demo-engine.js',
  'SharedFixOrder.json': 'artifacts/SharedFixOrder.json',
  'MockUSDC.json': 'artifacts/MockUSDC.json',
  'order-terms.json': 'docs/order-terms.json',
  'example-delivery.json': 'docs/example-delivery.json',
  'ganache.min.js': path.join(ganache, 'dist/web/ganache.min.js'),
  'ganache.LICENSE.txt': path.join(ganache, 'LICENSE'),
  'ganache.min.js.LICENSE.txt': path.join(ganache, 'dist/web/ganache.min.js.LICENSE.txt'),
  'ethers.umd.min.js': path.join(ethers, 'ethers.umd.min.js'),
  'ethers.LICENSE.txt': path.join(ethers, '../LICENSE.md')
};

fs.mkdirSync(output, { recursive: true });
for (const [name, source] of Object.entries(files)) {
  fs.copyFileSync(path.resolve(root, source), path.join(output, name));
}
let html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
for (const name of ['styles.css', 'app.js']) {
  const bytes = fs.readFileSync(path.join(output, name));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const ext = path.extname(name);
  const versioned = path.basename(name, ext) + '.' + hash + ext;
  fs.writeFileSync(path.join(output, versioned), bytes);
  html = html.replace('./' + name, './' + versioned);
}
fs.writeFileSync(path.join(output, 'index.html'), html);
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log('Browser demo built in dist/');

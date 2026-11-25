const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { SharedFixDemo } = require('./engine.cjs');

const demo = new SharedFixDemo();
const host = '127.0.0.1';
const assetFiles = {
  '/': ['web/index.html', 'text/html; charset=utf-8'],
  '/index.html': ['web/index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['web/styles.css', 'text/css; charset=utf-8'],
  '/demo-client.js': ['web/server-client.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['web/app.js', 'text/javascript; charset=utf-8'],
  '/example-delivery.json': ['docs/example-delivery.json', 'application/json; charset=utf-8'],
  '/order-terms.json': ['docs/order-terms.json', 'application/json; charset=utf-8']
};
let queue = Promise.resolve();
let allowedHost;

function respond(response, status, data, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  response.end(type.startsWith('application/json') && !Buffer.isBuffer(data) ? JSON.stringify(data) : data);
}

async function readAction(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('Expected application/json.');
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) throw new Error('Request too large.');
  }
  return JSON.parse(body);
}

const server = http.createServer(async (request, response) => {
  if (request.headers.host !== allowedHost ||
      (request.headers.origin && request.headers.origin !== `http://${allowedHost}`)) {
    return respond(response, 403, { error: 'This demo accepts requests from its local page only.' });
  }
  const urlPath = new URL(request.url, `http://${allowedHost}`).pathname;
  if (request.method === 'GET' && Object.hasOwn(assetFiles, urlPath)) {
    const [file, contentType] = assetFiles[urlPath];
    return respond(response, 200, fs.readFileSync(path.join(__dirname, file)), contentType);
  }
  if (request.method === 'GET' && urlPath === '/favicon.ico') return respond(response, 204, '');
  if ((request.method === 'GET' && urlPath === '/api/state') || (request.method === 'POST' && urlPath === '/api/action')) {
    const run = queue.then(async () => {
      if (urlPath === '/api/state') return demo.snapshot();
      const { scenario, action, role } = await readAction(request);
      return demo.action(scenario, action, role);
    });
    queue = run.catch(() => {});
    try {
      return respond(response, 200, await run);
    } catch (error) {
      console.error(error.message);
      return respond(response, 500, { error: 'The local demo could not complete this action. See the launcher window for details.' });
    }
  }
  respond(response, 404, { error: 'Not found' });
});

async function start({ port = Number(process.env.SHAREDFIX_PORT || 8787), open = false } = {}) {
  await demo.reset();
  const listen = (requestedPort) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  try {
    await listen(port);
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    await listen(0);
  }
  allowedHost = `${host}:${server.address().port}`;
  const url = `http://${allowedHost}/`;
  console.log(`SharedFix is ready: ${url}`);
  console.log('Keep this window open during the demonstration. Close it to end the local session.');
  if (open && process.platform === 'win32') {
    execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true });
  }
  return url;
}

async function stop() {
  await new Promise((resolve) => server.close(resolve));
  await demo.close();
}

if (require.main === module) {
  start({ open: process.argv.includes('--open') }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { start, stop };

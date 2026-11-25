const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');

const contracts = ['MockUSDC', 'SharedFixOrder'];
const sources = Object.fromEntries(contracts.map((name) => [
  `${name}.sol`, { content: fs.readFileSync(path.join(__dirname, 'contracts', `${name}.sol`), 'utf8') }
]));
const input = {
  language: 'Solidity', sources,
  settings: {
    viaIR: true,
    evmVersion: 'shanghai',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const failures = (output.errors || []).filter((item) => item.severity === 'error');
if (failures.length) throw new Error(failures.map((item) => item.formattedMessage).join('\n'));
const folder = path.join(__dirname, 'artifacts');
fs.mkdirSync(folder, { recursive: true });
for (const name of contracts) {
  const contract = output.contracts[`${name}.sol`][name];
  fs.writeFileSync(path.join(folder, `${name}.json`), JSON.stringify({
    compiler: solc.version(), settings: input.settings,
    abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`
  }, null, 2));
  console.log(`Compiled ${name}`);
}

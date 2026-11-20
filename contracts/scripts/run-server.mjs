// Persistent Hardhat server script for CredPass.
// Starts a Hardhat node that stays alive, binds to 0.0.0.0 (accessible from other devices),
// and uses instant mining so transactions confirm immediately.

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('Starting persistent Hardhat node...');
console.log('Node will bind to 0.0.0.0:8545 (accessible from other devices on the network)');

const node = spawn('npx', ['hardhat', 'node', '--hostname', '0.0.0.0', '--port', '8545'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true,
});

node.on('error', (err) => {
  console.error('Failed to start Hardhat node:', err);
  process.exit(1);
});

node.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Hardhat node exited with code ${code}`);
    process.exit(code || 1);
  }
});

process.on('SIGINT', () => {
  console.log('Stopping Hardhat node...');
  node.kill('SIGTERM');
});

process.on('SIGTERM', () => {
  console.log('Stopping Hardhat node...');
  node.kill('SIGTERM');
});

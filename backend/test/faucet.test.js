// Faucet integration check against a RUNNING backend on the local Hardhat node.
// Skips gracefully when the backend or the node is not available (the other
// backend tests are static-source checks and work without either).
// Verifies plan item 1: a fresh address balance increases after /faucet/drip
// and the 10-drips-per-hour rate limit eventually returns 429.
import { Wallet } from 'ethers';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';

const results = [];
const push = (ok, msg) => results.push(`${ok ? 'PASS' : 'FAIL'}: ${msg}`);
let skipped = false;

async function post(path, body) {
    const res = await fetch(BACKEND_URL + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error body */ }
    return { status: res.status, data };
}

async function rpc(method, params) {
    const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return res.json();
}

// 1. Guard: backend must be running
let health = null;
try {
    const res = await fetch(BACKEND_URL + '/health');
    health = await res.json();
} catch (e) {
    skipped = true;
}
if (skipped || !health || health.status !== 'ok') {
    console.log('SKIP: backend not running on ' + BACKEND_URL + ' — start it with `node server.js` first.');
    process.exit(0);
}

// Fresh per-run test address (never funds a real wallet)
const dripTarget = Wallet.createRandom().address;

// Current balance via the node's RPC
async function getBalanceETH() {
    const r = await rpc('eth_getBalance', [dripTarget, 'latest']);
    if (!r || !r.result) return null;
    return Number(BigInt(r.result)) / 1e18;
}

const before = await getBalanceETH();
if (before === null) {
    console.log('SKIP: local Hardhat node not reachable on ' + RPC_URL + '.');
    process.exit(0);
}

const drip1 = await post('/faucet/drip', { userAddress: dripTarget });
if (drip1.status === 200 && typeof drip1.data?.balanceETH === 'string') {
    const after = await getBalanceETH();
    push(after !== null && after > before, `balance increased after first drip (${before} -> ${after} ETH)`);
    push(drip1.data.txHash && /^0x[0-9a-fA-F]{64}$/.test(drip1.data.txHash), 'drip returns a tx hash');
} else if (drip1.status === 403 || drip1.status === 502 || drip1.status === 503) {
    console.log('SKIP: faucet unavailable right now (' + drip1.status + ' ' + JSON.stringify(drip1.data) + ').');
    process.exit(0);
} else {
    push(false, 'first drip expected 200, got ' + drip1.status + ' ' + JSON.stringify(drip1.data));
}

// 2. Invalid input guard
const bad = await post('/faucet/drip', { userAddress: '0xdead' });
push(bad.status === 400, 'invalid address returns 400');

// 3. Drain the remaining rate-limit budget, expect 429 afterwards
let limitHit = false;
for (let i = 0; i < 10; i++) {
    const r = await post('/faucet/drip', { userAddress: dripTarget });
    if (r.status === 429) { limitHit = true; break; }
    if (r.status >= 500) {
        console.log('SKIP: chain error during drip loop (' + r.status + ').');
        process.exit(0);
    }
}
push(limitHit, 'rate limit returns 429 after 10 drips per hour');

console.log('Faucet test results:');
results.forEach(r => console.log(' ', r));
console.log('All passed:', results.every(r => r.startsWith('PASS')) && results.length > 0);
process.exit(results.every(r => r.startsWith('PASS')) && results.length > 0 ? 0 : 1);

// Real backend integration tests (IMPROVEMENT_PLAN.md item 14).
// Spins the exported Express app on an ephemeral port (supertest) — the
// running production server is NOT touched. Endpoint behavior is verified
// against the real local Postgres (docker) and, when reachable, the local
// Hardhat node. Everything skips gracefully when its dependency is absent.
//
// Named regression case included: stale deployment-config handling — the
// server must re-read contracts/config/deploy-local.json PER REQUEST (the
// bug found and fixed in an earlier session: /repayments/record used to
// validate receipts against the previous contract address).
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';

// server.js skips app.listen when NODE_ENV === 'test' — MUST be set before
// the dynamic import below so tests bind their own ephemeral port only.
process.env.NODE_ENV = 'test';

const results = [];
const push = (ok, msg) => results.push(`${ok ? 'PASS' : 'FAIL'}: ${msg}`);
let failed = 0;

const CONFIG_PATH = path.join(__dirname, '..', '..', 'contracts', 'config', 'deploy-local.json');
let chainConfig = null;
try {
    chainConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) { /* chain-dependent cases will skip */ }

async function nodeReachable() {
    try {
        const r = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
        });
        return r.ok;
    } catch (e) {
        return false;
    }
}

const { app } = await import('../server.js');

// 1. Health
{
    const res = await request(app).get('/health');
    if (res.status !== 200 || res.body?.status !== 'ok') {
        console.log('SKIP: backend environment unhealthy (health ' + res.status + ', body: ' + JSON.stringify(res.body) + ')');
        process.exit(res.status === 503 ? 0 : 1);
    }
    push(res.body.database === 'connected', 'health reports database connected');
}

// 2. Input validation: malformed address
{
    const res = await request(app).post('/credentials/issue').send({ userAddress: '0xdead' });
    push(res.status === 400 && typeof res.body.error === 'string', 'issue rejects malformed address with 400 + {error}');
}

// 3. Tier is computed server-side only: client-supplied tier must be ignored.
// Consistency invariant: the signed credential tier ALWAYS equals the listed
// evaluation tier (which comes from evaluateBorrower, never from the request).
{
    const res = await request(app)
        .post('/credentials/issue')
        .send({ userAddress: '0x0000000000000000000000000000000000000001', tier: 'A' });
    if (res.status !== 200) {
        push(false, 'issue accepts a valid address (got ' + res.status + ')');
        failed++;
    } else {
        push(res.body.credential?.tier === res.body.evaluation?.tier, 'signed tier always equals DB-evaluated tier (client tier ignored)');
        push(/^0x[0-9a-fA-F]{64}$/.test(res.body.tierHash || ''), 'tierHash is a 32-byte hex hash');
        push(/^0x[0-9a-fA-F]+$/.test(res.body.signature || ''), 'signature present and hex-encoded');
        push(Number.isInteger(res.body.credential?.issuedAt) && res.body.credential.issuedAt > 0, 'credential carries integer issuedAt');
        push(Array.isArray(res.body.progress?.requirements), 'progress carries requirements list');
        if (chainConfig?.evaluatorAddress) {
            push((res.body.signer || '').toLowerCase() === chainConfig.evaluatorAddress.toLowerCase(), 'signer matches evaluatorAddress in deploy-local.json');
        }
    }
}

// 4. Chain-dependent guards on /repayments/record
if (chainConfig?.contractAddress && await nodeReachable()) {
    const NO_LOAN_WALLET = '0x0000000000000000000000000000000000000001'; // never borrowed on-chain
    const HAS_LOAN_WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // flow-check borrower (repaid)
    const fakeTx = '0x' + 'ab'.repeat(32); // well-formed 32-byte hash, no such receipt

    // 4a. Semantic stages, real config: no-loan wallet hits the loan check (404)
    {
        const res = await request(app)
            .post('/repayments/record')
            .send({ userAddress: NO_LOAN_WALLET, txHash: fakeTx });
        push(res.status === 404 && /No loan record/i.test(res.body.error || ''), 'no-loan wallet rejected at loan-state stage (404)');
    }

    // 4b. Wallet with an (repaid) on-chain loan passes the loan stage, then the
    // fabricated tx must fail at the receipt stage (400).
    {
        const res = await request(app)
            .post('/repayments/record')
            .send({ userAddress: HAS_LOAN_WALLET, txHash: fakeTx });
        push(res.status === 400 && /Unknown or failed transaction/i.test(res.body.error || ''), 'fabricated tx for repaid-loan wallet rejected at receipt stage (400)');
    }

    // 4c. NAMED REGRESSION: deployment config is re-read per request.
    // Point the config at a fake address; the SAME request that previously
    // failed at the loan stage (404, real contract) must now fail EARLIER at
    // the contract-read stage (503, no code at fake address) — proving the
    // per-request config reload instead of a cached address.
    const original = fs.readFileSync(CONFIG_PATH, 'utf8');
    try {
        const fakeConfig = JSON.parse(original);
        fakeConfig.contractAddress = '0x9999999999999999999999999999999999999999';
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(fakeConfig, null, 2) + '\n');
        const res = await request(app)
            .post('/repayments/record')
            .send({ userAddress: NO_LOAN_WALLET, txHash: fakeTx });
        push(res.status === 503 && /Failed to read contract state/i.test(res.body.error || ''), 'stale-config regression: config re-read per request (fake address -> 503 contract read)');
        // /credentials/issue must still issue with chain reads degrading gracefully
        const res2 = await request(app)
            .post('/credentials/issue')
            .send({ userAddress: NO_LOAN_WALLET });
        push(res2.status === 200 && res2.body?.credential?.tier, 'issue degrades gracefully with fake chain config (local-clock issuedAt is fine)');
    } finally {
        fs.writeFileSync(CONFIG_PATH, original);
    }
    // Restore verified: back to real address, the loan stage hits again (404)
    {
        const res = await request(app)
            .post('/repayments/record')
            .send({ userAddress: NO_LOAN_WALLET, txHash: fakeTx });
        push(res.status === 404, 'restored config takes effect on next request (real address -> 404 loan stage)');
    }

    // 4d. /repayments/record requires a valid txHash format
    {
        const res = await request(app)
            .post('/repayments/record')
            .send({ userAddress: NO_LOAN_WALLET, txHash: 'not-a-hash' });
        push(res.status === 400, 'malformed txHash rejected with 400');
    }
} else {
    console.log('SKIP: chain-dependent /repayments cases (node or deploy-local.json unavailable)');
}

// 5. Rate limiting on /credentials/issue — hammer LAST because the sliding
// window is shared per IP for the whole process.
{
    let saw429 = false;
    for (let i = 0; i < 30; i++) {
        const res = await request(app)
            .post('/credentials/issue')
            .send({ userAddress: '0x0000000000000000000000000000000000000002' });
        if (res.status === 429) { saw429 = true; break; }
        if (res.status >= 500) break;
    }
    push(saw429, 'issue rate limit engages (429 within 20/min window)');
}

for (const line of results) console.log(' ', line);
failed += results.filter(r => r.startsWith('FAIL')).length;
console.log('Integration test:', failed === 0 && results.length > 0 ? 'ALL PASS' : 'FAILURES PRESENT');
process.exit(failed === 0 && results.length > 0 ? 0 : 1);

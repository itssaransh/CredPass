import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Wallet, TypedDataEncoder, getBytes, Contract, JsonRpcProvider, Interface, formatEther, parseEther } from 'ethers';
import { healthDB, getPool } from './services/db.js';
import { evaluateBorrower, getTierProgress } from './services/evaluation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Active local deployment config (shared with contracts + frontend via deploy-local.json)
// The config file is re-read per request so contract redeployments apply without restarts.
function loadChainConfig() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'config', 'deploy-local.json'), 'utf8'));
    } catch (e) {
        return null;
    }
}
let poolAbi = null;
try {
    poolAbi = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'artifacts', 'contracts', 'CredPassLendingPool.sol', 'CredPassLendingPool.json'), 'utf8')).abi;
} catch (e) { /* chain features degrade gracefully */ }

// Conversion used only for credit scoring of on-chain repayments (USD terms).
const ETH_USD_PRICE = Number(process.env.ETH_USD_PRICE) || 2750;
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';

const app = express();
app.use(express.json());

app.get('/health', async (req, res) => {
    const dbHealth = await healthDB();
    res.json({
        status: 'ok',
        service: 'credpass-backend',
        database: dbHealth.ok ? 'connected' : 'unavailable',
        dbError: dbHealth.ok ? undefined : dbHealth.error
    });
});

// ---------------------------------------------------------------------------
// In-memory rate limiter (plan item 12): /credentials/issue signs with a hot
// key per request, so cap it at 20 requests/min per client IP.
// ---------------------------------------------------------------------------
const issueRateLog = new Map(); // ip -> [timestamps]
const ISSUE_RATE_LIMIT = 20;
const ISSUE_RATE_WINDOW_MS = 60 * 1000;

function issueRateLimiter(req, res, next) {
    const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();
    const recent = (issueRateLog.get(ip) || []).filter(t => now - t < ISSUE_RATE_WINDOW_MS);
    if (recent.length >= ISSUE_RATE_LIMIT) {
        return res.status(429).json({ error: 'Too many credential requests (max 20/min). Try again shortly.' });
    }
    recent.push(now);
    issueRateLog.set(ip, recent);
    next();
}

app.post('/credentials/issue', issueRateLimiter, async (req, res) => {
    const { userAddress } = req.body;
    // Requirement: never accept tier or repayment history from client as authoritative
    // The evaluation service calculates tier exclusively from DB records
    if (!userAddress || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return res.status(400).json({ error: 'invalid or missing Ethereum address' });
    }

    let evaluation;
    try {
        evaluation = await evaluateBorrower(userAddress);
    } catch (e) {
        // Database or evaluation failure must not issue a credential
        return res.status(503).json({ error: 'Credit evaluation unavailable', detail: e.message });
    }

    const tier = evaluation.tier;
    const evaluator = new Wallet(process.env.EVALUATOR_PRIVATE_KEY || '0x' + '1'.repeat(64));

    // Credential freshness (plan item 11): issuedAt is part of the signed
    // EIP-712 struct. Prefer the chain's latest block timestamp (avoids local
    // vs chain clock drift); degrade to local time if the node is unreachable.
    const chainConfig = loadChainConfig();
    let issuedAt = Math.floor(Date.now() / 1000);
    let tierParams = null;
    try {
        const provider = new JsonRpcProvider((chainConfig && chainConfig.rpcUrl) || RPC_URL);
        let latest;
        try {
            latest = await provider.getBlock('latest');
            if (latest && latest.timestamp) issuedAt = latest.timestamp;
        } catch (e) { /* keep local-clock issuedAt */ }

        // Tier terms come from the contract (single source of truth, item 8);
        // degrade to the DB-derived defaults if the chain read fails.
        try {
            if (chainConfig && chainConfig.contractAddress && poolAbi) {
                const poolContract = new Contract(chainConfig.contractAddress, poolAbi, provider);
                const [limitWei, rateBps] = await Promise.all([poolContract.tierLimits(tier), poolContract.tierRates(tier)]);
                if (limitWei > 0n) {
                    tierParams = {
                        maxLoanUSD: Number(formatEther(limitWei)) * ETH_USD_PRICE,
                        ratePercent: Number(rateBps) / 100,
                        source: 'chain',
                    };
                }
            }
        } catch (e) { /* config fallback below */ }
    } catch (e) { /* issuedAt local fallback already set */ }

    const domain = { name: 'CredPass', version: '1' };
    const types = {
        Credential: [
            { name: 'tier', type: 'string' },
            { name: 'userAddress', type: 'address' },
            { name: 'issuedAt', type: 'uint256' },
        ],
    };
    const value = { tier, userAddress, issuedAt };

    const hash = TypedDataEncoder.hash(domain, types, value);
    const signature = evaluator.signingKey.sign(getBytes(hash)).serialized;

    // Preserve existing EIP-712 credential structure; include evaluation details
    res.json({
        tierHash: hash,
        credential: value,
        evaluation: {
            tier,
            repaymentRecords: evaluation.count,
            totalPaidUSD: evaluation.totalPaidUSD,
            averagePaidUSD: evaluation.averagePaidUSD,
            lendingParams: tierParams || evaluation.lendingParams,
        },
        progress: getTierProgress(evaluation),
        signature,
        signer: evaluator.address
    });
});

app.get('/credentials/verify', (req, res) => {
    res.json({ message: 'Pass signature + tierHash to smart contract verifyAndIssueLoan' });
});

// ---------------------------------------------------------------------------
// Local-only test-ETH faucet.
// Design constraints (see IMPROVEMENT_PLAN.md item 1): no throwaway production
// keys. If FAUCET_PRIVATE_KEY is set in the environment it is used; otherwise
// the backend falls back to the publicly known Hardhat default account #0 dev
// key (chainId 31337 "test...junk" mnemonic — public by construction on local
// chains). The route is hard-guarded so it can never fire on a remote chain:
// the RPC must point at localhost and the chain id must be 31337.
// Rate limit: max 10 drips per hour per address, in-memory.
// ---------------------------------------------------------------------------
const FAUCET_PRIVATE_KEY = process.env.FAUCET_PRIVATE_KEY
    || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const FAUCET_DRIP_WEI = parseEther('0.5');
const FAUCET_RATE_LIMIT = 10;
const FAUCET_RATE_WINDOW_MS = 60 * 60 * 1000;
const dripLog = new Map(); // lowercase address -> [timestamps of recent drips]

app.post('/faucet/drip', async (req, res) => {
    const { userAddress } = req.body;
    if (!userAddress || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return res.status(400).json({ error: 'invalid or missing Ethereum address' });
    }

    const chainConfig = loadChainConfig();
    const rpcUrl = (chainConfig && chainConfig.rpcUrl) || RPC_URL;
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(rpcUrl)) {
        return res.status(403).json({ error: 'Faucet is available only on a local development node' });
    }

    let provider;
    try {
        provider = new JsonRpcProvider(rpcUrl);
    } catch (e) {
        return res.status(503).json({ error: 'Chain RPC unavailable', detail: e.message });
    }

    let chainId;
    try {
        chainId = (await provider.getNetwork()).chainId;
    } catch (e) {
        return res.status(503).json({ error: 'Chain node unreachable', detail: e.message });
    }
    if (chainId !== 31337n) {
        return res.status(403).json({ error: 'Faucet is available only on the local Hardhat chain (31337)' });
    }

    // Rate limiting (per address, in-memory window)
    const key = userAddress.toLowerCase();
    const now = Date.now();
    const recent = (dripLog.get(key) || []).filter(t => now - t < FAUCET_RATE_WINDOW_MS);
    if (recent.length >= FAUCET_RATE_LIMIT) {
        return res.status(429).json({ error: `Faucet rate limit reached (${FAUCET_RATE_LIMIT} drips per hour). Try again later.` });
    }

    try {
        const faucetWallet = new Wallet(FAUCET_PRIVATE_KEY, provider);
        const tx = await faucetWallet.sendTransaction({ to: userAddress, value: FAUCET_DRIP_WEI });
        const receipt = await tx.wait();
        recent.push(now);
        dripLog.set(key, recent);
        const balance = await provider.getBalance(userAddress);
        return res.json({
            token: 'ETH',
            amount: '0.5',
            txHash: receipt.hash,
            balanceETH: formatEther(balance),
        });
    } catch (e) {
        return res.status(502).json({ error: 'Faucet transfer failed', detail: e.message });
    }
});


// Records a verified on-chain repayment into the credit ledger.
// Trust model: the client cannot inject amounts. The backend looks up the
// transaction receipt on the node, requires a LoanRepaid event emitted by the
// active pool contract for this exact wallet, and only then records the
// repayment (amount = event value converted to USD). Tx hash dedup prevents
// double-crediting the same repayment.
app.post('/repayments/record', async (req, res) => {
    const { userAddress, txHash } = req.body || {};
    if (!userAddress || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return res.status(400).json({ error: 'invalid or missing Ethereum address' });
    }
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        return res.status(400).json({ error: 'invalid or missing transaction hash' });
    }
    if (!poolAbi) {
        return res.status(503).json({ error: 'Chain configuration unavailable' });
    }
    const chainConfig = loadChainConfig();
    if (!chainConfig || !chainConfig.contractAddress) {
        return res.status(503).json({ error: 'Deployment config missing (contracts/config/deploy-local.json)' });
    }

    let provider;
    try {
        provider = new JsonRpcProvider(chainConfig.rpcUrl || RPC_URL);
    } catch (e) {
        return res.status(503).json({ error: 'Chain RPC unavailable' });
    }

    const poolContract = new Contract(chainConfig.contractAddress, poolAbi, provider);

    // 1. On-chain loan state must show a repaid loan for this wallet
    let loan;
    try {
        loan = await poolContract.getLoan(userAddress);
    } catch (e) {
        return res.status(503).json({ error: 'Failed to read contract state', detail: e.message });
    }
    if (loan.borrowerAddr === '0x0000000000000000000000000000000000000000') {
        return res.status(404).json({ error: 'No loan record for this wallet' });
    }
    if (!loan.repaidVal) {
        return res.status(409).json({ error: 'Loan is not repaid yet' });
    }

    // 2. The submitted transaction must be a successful LoanRepaid for this wallet
    let receipt;
    try {
        receipt = await provider.getTransactionReceipt(txHash);
    } catch (e) {
        return res.status(503).json({ error: 'Failed to read receipt', detail: e.message });
    }
    if (!receipt || receipt.status !== 1) {
        return res.status(400).json({ error: 'Unknown or failed transaction' });
    }
    const iface = new Interface(poolAbi);
    let repaidAmountWei = null;
    for (const log of receipt.logs) {
        if (!log.address || log.address.toLowerCase() !== chainConfig.contractAddress.toLowerCase()) continue;
        try {
            const parsed = iface.parseLog({ topics: log.topics, data: log.data });
            if (parsed && parsed.name === 'LoanRepaid' && parsed.args.borrower.toLowerCase() === userAddress.toLowerCase()) {
                repaidAmountWei = parsed.args.amount;
                break;
            }
        } catch (e) { /* log from another contract — skip */ }
    }
    if (repaidAmountWei === null) {
        return res.status(400).json({ error: 'Transaction is not a LoanRepaid event for this wallet' });
    }

    // 3. Persist with tx-hash dedup (unique partial index on tx_hash)
    const amountETH = parseFloat(formatEther(repaidAmountWei));
    const amountUSD = amountETH * ETH_USD_PRICE;
    try {
        const client = await getPool().connect();
        try {
            await client.query('BEGIN');
            await client.query(
                'INSERT INTO credpass.borrowers (wallet_address) VALUES ($1) ON CONFLICT DO NOTHING',
                [userAddress]
            );
            const insertRes = await client.query(
                "INSERT INTO credpass.repayment_records (wallet_address, amount_paid, currency, source, tx_hash) VALUES ($1, $2, 'USD', 'onchain_repay', $3) ON CONFLICT DO NOTHING",
                [userAddress, amountUSD.toFixed(2), txHash]
            );
            await client.query('COMMIT');
            const recorded = insertRes.rowCount > 0;

            // Recompute evaluation so the client immediately sees the new tier
            const evaluation = await evaluateBorrower(userAddress);
            return res.json({
                recorded,
                alreadyRecorded: !recorded,
                repayment: {
                    amountETH,
                    amountUSD,
                    txHash,
                },
                evaluation,
                progress: getTierProgress(evaluation),
            });
        } finally {
            client.release();
        }
    } catch (e) {
        try { await getPool().query('ROLLBACK'); } catch (_) { /* no tx to roll back */ }
        return res.status(503).json({ error: 'Database unavailable', detail: e.message });
    }
});

const PORT = process.env.PORT || 4000;
// The listener is skipped in test mode so supertest-style tests can bind
// their own ephemeral port; `export { app }` below serves those tests.
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`CredPass backend running on http://localhost:${PORT}`);
    });
}

export { app };

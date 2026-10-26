// Cloudflare Workers entrypoint.
//
// Routes (both with and without the /api prefix, matching the Node backend):
//   GET  /health
//   POST /credentials/issue
//   GET  /credentials/verify
//   POST /faucet/drip
//   POST /repayments/record
//
// Everything else is served from the built React app via the ASSETS binding.
import {
    Wallet,
    TypedDataEncoder,
    getBytes,
    Contract,
    JsonRpcProvider,
    Interface,
    formatEther,
    parseEther,
    ZeroAddress,
} from 'ethers';
import { getTierProgress } from '../services/scoring.js';
import { healthDB, evaluateBorrower, recordRepayment } from './db.js';
import { POOL_ABI } from './abi.js';

// Deterministic local dev evaluator key. It derives 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A,
// which matches contracts/config/deploy-local.json. Set EVALUATOR_PRIVATE_KEY
// as a Worker secret to use a different evaluator.
const DEFAULT_EVALUATOR_KEY = '0x' + '1'.repeat(64);
// Publicly known Hardhat account #0 key; the faucet is hard-guarded to a local
// chain anyway, so this never moves real funds.
const DEFAULT_FAUCET_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
};

const API_PATHS = new Set([
    '/health',
    '/credentials/issue',
    '/credentials/verify',
    '/faucet/drip',
    '/repayments/record',
]);

// ---------------------------------------------------------------------------
// In-memory rate limiters. Workers isolates are short-lived and not shared
// across PoPs, so these are best-effort abuse guards, not billing-grade limits.
// ---------------------------------------------------------------------------
const issueLog = new Map(); // ip -> [timestamps]
const dripLog = new Map(); // lowercase address -> [timestamps]

function rateLimited(log, key, limit, windowMs) {
    const now = Date.now();
    const recent = (log.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) return true;
    recent.push(now);
    log.set(key, recent);
    return false;
}

function isAddress(value) {
    return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isTxHash(value) {
    return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
}

async function readJson(request) {
    try {
        return await request.json();
    } catch {
        return {};
    }
}

function makeProvider(rpcUrl) {
    return new JsonRpcProvider(rpcUrl);
}

function ethUsdPrice(env) {
    const parsed = Number(env.ETH_USD_PRICE);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2750;
}

function isLocalRpc(rpcUrl) {
    return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(rpcUrl || '');
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
async function handleHealth(env) {
    const dbHealth = await healthDB(env);
    return json({
        status: 'ok',
        service: 'credpass-worker',
        database: dbHealth.ok ? 'connected' : 'unavailable',
        dbError: dbHealth.ok ? undefined : dbHealth.error,
    });
}

// ---------------------------------------------------------------------------
// POST /credentials/issue
// ---------------------------------------------------------------------------
async function handleIssue(request, env) {
    const { userAddress } = await readJson(request);
    if (!isAddress(userAddress)) {
        return json({ error: 'invalid or missing Ethereum address' }, 400);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(issueLog, ip, 20, 60 * 1000)) {
        return json({ error: 'Too many credential requests (max 20/min). Try again shortly.' }, 429);
    }

    let evaluation;
    try {
        evaluation = await evaluateBorrower(env, userAddress);
    } catch (e) {
        return json({ error: 'Credit evaluation unavailable', detail: e.message }, 503);
    }

    const tier = evaluation.tier;
    // The evaluator key never leaves the Worker. EVALUATOR_PRIVATE_KEY is a
    // secret binding, not a public var.
    const evaluator = new Wallet(env.EVALUATOR_PRIVATE_KEY || DEFAULT_EVALUATOR_KEY);

    // Freshness: local clock. Ethereum block timestamps are close enough for the
    // contract's 1-day window; there is no local Hardhat node in the cloud.
    const issuedAt = Math.floor(Date.now() / 1000);

    // Optional: read the canonical tier terms from a deployed pool contract.
    let tierParams = null;
    if (env.RPC_URL && env.POOL_ADDRESS) {
        const provider = makeProvider(env.RPC_URL);
        try {
            const pool = new Contract(env.POOL_ADDRESS, POOL_ABI, provider);
            const [limitWei, rateBps] = await Promise.all([
                pool.tierLimits(tier),
                pool.tierRates(tier),
            ]);
            if (limitWei > 0n) {
                tierParams = {
                    maxLoanUSD: Number(formatEther(limitWei)) * ethUsdPrice(env),
                    ratePercent: Number(rateBps) / 100,
                    source: 'chain',
                };
            }
        } catch {
            /* chain unavailable: fall back to DB-derived terms */
        } finally {
            provider.destroy();
        }
    }

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

    return json({
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
        signer: evaluator.address,
    });
}

// ---------------------------------------------------------------------------
// POST /faucet/drip  (local development only, by design)
// ---------------------------------------------------------------------------
async function handleFaucet(request, env) {
    const { userAddress } = await readJson(request);
    if (!isAddress(userAddress)) {
        return json({ error: 'invalid or missing Ethereum address' }, 400);
    }

    if (!isLocalRpc(env.RPC_URL)) {
        return json({ error: 'Faucet is available only on a local development node' }, 403);
    }

    const key = userAddress.toLowerCase();
    if (rateLimited(dripLog, key, 10, 60 * 60 * 1000)) {
        return json({ error: 'Faucet rate limit reached (10 drips per hour). Try again later.' }, 429);
    }

    const provider = makeProvider(env.RPC_URL);
    try {
        const network = await provider.getNetwork();
        if (network.chainId !== 31337n) {
            return json({ error: 'Faucet is available only on the local Hardhat chain (31337)' }, 403);
        }
        const faucetWallet = new Wallet(env.FAUCET_PRIVATE_KEY || DEFAULT_FAUCET_KEY, provider);
        const tx = await faucetWallet.sendTransaction({ to: userAddress, value: parseEther('0.5') });
        const receipt = await tx.wait();
        const balance = await provider.getBalance(userAddress);
        return json({
            token: 'ETH',
            amount: '0.5',
            txHash: receipt.hash,
            balanceETH: formatEther(balance),
        });
    } catch (e) {
        return json({ error: 'Faucet transfer failed', detail: e.message }, 502);
    } finally {
        provider.destroy();
    }
}

// ---------------------------------------------------------------------------
// POST /repayments/record
// ---------------------------------------------------------------------------
async function handleRecordRepayment(request, env) {
    const { userAddress, txHash } = await readJson(request);
    if (!isAddress(userAddress)) {
        return json({ error: 'invalid or missing Ethereum address' }, 400);
    }
    if (!isTxHash(txHash)) {
        return json({ error: 'invalid or missing transaction hash' }, 400);
    }
    if (!env.RPC_URL || !env.POOL_ADDRESS) {
        return json({ error: 'Chain configuration unavailable (set RPC_URL and POOL_ADDRESS)' }, 503);
    }

    const provider = makeProvider(env.RPC_URL);
    try {
        const pool = new Contract(env.POOL_ADDRESS, POOL_ABI, provider);

        // 1. On-chain loan state must show a repaid loan for this wallet.
        const loan = await pool.getLoan(userAddress);
        if (loan.borrowerAddr === ZeroAddress) {
            return json({ error: 'No loan record for this wallet' }, 404);
        }
        if (!loan.repaidVal) {
            return json({ error: 'Loan is not repaid yet' }, 409);
        }

        // 2. The submitted transaction must be a successful LoanRepaid for this wallet.
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt || receipt.status !== 1) {
            return json({ error: 'Unknown or failed transaction' }, 400);
        }

        const iface = new Interface(POOL_ABI);
        let repaidAmountWei = null;
        for (const log of receipt.logs) {
            if (!log.address || log.address.toLowerCase() !== env.POOL_ADDRESS.toLowerCase()) continue;
            try {
                const parsed = iface.parseLog({ topics: log.topics, data: log.data });
                if (parsed && parsed.name === 'LoanRepaid' && parsed.args.borrower.toLowerCase() === userAddress.toLowerCase()) {
                    repaidAmountWei = parsed.args.amount;
                    break;
                }
            } catch {
                /* log from another contract - skip */
            }
        }
        if (repaidAmountWei === null) {
            return json({ error: 'Transaction is not a LoanRepaid event for this wallet' }, 400);
        }

        // 3. Persist with tx-hash dedup, then return the refreshed evaluation.
        const amountETH = parseFloat(formatEther(repaidAmountWei));
        const amountUSD = amountETH * ethUsdPrice(env);
        const { recorded } = await recordRepayment(env, { walletAddress: userAddress, amountUSD, txHash });
        const evaluation = await evaluateBorrower(env, userAddress);

        return json({
            recorded,
            alreadyRecorded: !recorded,
            repayment: { amountETH, amountUSD, txHash },
            evaluation,
            progress: getTierProgress(evaluation),
        });
    } catch (e) {
        return json({ error: 'Chain or database unavailable', detail: e.message }, 503);
    } finally {
        provider.destroy();
    }
}

export default {
    async fetch(request, env, _ctx) {
        const url = new URL(request.url);
        const viaApiPrefix = url.pathname === '/api' || url.pathname.startsWith('/api/');
        const path = viaApiPrefix ? url.pathname.slice(4) || '/' : url.pathname;
        const isApi = viaApiPrefix || API_PATHS.has(path);

        if (!isApi) {
            return env.ASSETS.fetch(request);
        }

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        try {
            if (path === '/health' && request.method === 'GET') {
                return await handleHealth(env);
            }
            if (path === '/credentials/issue' && request.method === 'POST') {
                return await handleIssue(request, env);
            }
            if (path === '/credentials/verify' && request.method === 'GET') {
                return json({ message: 'Pass signature + tierHash to smart contract verifyAndIssueLoan' });
            }
            if (path === '/faucet/drip' && request.method === 'POST') {
                return await handleFaucet(request, env);
            }
            if (path === '/repayments/record' && request.method === 'POST') {
                return await handleRecordRepayment(request, env);
            }
            return json({ error: 'Not found' }, 404);
        } catch (e) {
            return json({ error: 'Internal error', detail: e.message }, 500);
        }
    },
};

import { evaluateRecords } from '../services/scoring.js';

// Cloudflare D1 implementation of the small database surface the app needs.
// Mirrors backend/services/db.js (Postgres) so scoring rules stay identical.

export async function healthDB(env) {
    try {
        if (!env.DB) return { ok: false, error: 'D1 binding DB is not configured' };
        await env.DB.prepare('SELECT 1').first();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

export async function evaluateBorrower(env, walletAddress) {
    if (!env.DB) throw new Error('D1 binding DB is not configured');
    const { results } = await env.DB
        .prepare('SELECT amount_paid FROM repayment_records WHERE wallet_address = ?')
        .bind(walletAddress)
        .all();
    return evaluateRecords(results || []);
}

// Atomically records a verified on-chain repayment. The second statement is a
// no-op when this tx_hash was already credited (UNIQUE index on tx_hash).
export async function recordRepayment(env, { walletAddress, amountUSD, txHash }) {
    if (!env.DB) throw new Error('D1 binding DB is not configured');
    const results = await env.DB.batch([
        env.DB
            .prepare('INSERT INTO borrowers (wallet_address) VALUES (?) ON CONFLICT DO NOTHING')
            .bind(walletAddress),
        env.DB
            .prepare(
                "INSERT INTO repayment_records (wallet_address, amount_paid, currency, source, tx_hash) VALUES (?, ?, 'USD', 'onchain_repay', ?) ON CONFLICT DO NOTHING"
            )
            .bind(walletAddress, amountUSD.toFixed(2), txHash),
    ]);

    const insert = results[1];
    return { recorded: (insert && insert.meta && insert.meta.changes ? insert.meta.changes : 0) > 0 };
}

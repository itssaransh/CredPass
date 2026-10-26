import { getPool } from './db.js';
import { TIER_CRITERIA, getTierProgress, evaluateRecords } from './scoring.js';

// Re-exported so existing imports keep working.
export { TIER_CRITERIA, getTierProgress };

export async function evaluateBorrower(walletAddress) {
    const pool = getPool();

    const recordRes = await pool.query(
        'SELECT amount_paid FROM credpass.repayment_records WHERE wallet_address = $1',
        [walletAddress]
    );

    return evaluateRecords(recordRes.rows);
}

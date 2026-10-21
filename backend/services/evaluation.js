import { getPool } from './db.js';

// Tier rules (deterministic, based only on verified DB records):
// Tier A: >= 3 repayment records with total >= 5000 USD and average >= 1500 USD
// Tier B: >= 1 repayment record with total >= 1000 USD and average >= 500 USD
// Tier C: no eligible records OR total < 500 USD OR fewer than 1 record with amount >= 100 USD
export const TIER_CRITERIA = {
    B: [
        { label: 'Verified repayments', field: 'count', need: 1, unit: '' },
        { label: 'Total repaid (USD)', field: 'totalPaidUSD', need: 1000, unit: '$' },
        { label: 'Average repayment (USD)', field: 'averagePaidUSD', need: 500, unit: '$' },
    ],
    A: [
        { label: 'Verified repayments', field: 'count', need: 3, unit: '' },
        { label: 'Total repaid (USD)', field: 'totalPaidUSD', need: 5000, unit: '$' },
        { label: 'Average repayment (USD)', field: 'averagePaidUSD', need: 1500, unit: '$' },
    ],
};

// Progress toward the next tier, derived strictly from the same evaluation used
// for tier assignment (never from client input).
export function getTierProgress(evaluation) {
    const order = ['C', 'B', 'A'];
    const idx = order.indexOf(evaluation.tier);
    if (idx === -1 || idx === order.length - 1) {
        return { nextTier: null, requirements: [] };
    }
    const nextTier = order[idx + 1];
    const requirements = TIER_CRITERIA[nextTier].map(r => {
        const have = Number(evaluation[r.field]) || 0;
        return {
            label: r.label,
            unit: r.unit,
            have: r.field === 'count' ? have : Math.round(have),
            need: r.need,
            met: have >= r.need,
        };
    });
    return { nextTier, requirements };
}

export async function evaluateBorrower(walletAddress) {
    const pool = getPool();
    const borrowerRes = await pool.query(
        'SELECT wallet_address FROM credpass.borrowers WHERE wallet_address = $1',
        [walletAddress]
    );
    if (borrowerRes.rowCount === 0) {
        // No borrower record; still evaluate repayment history if present
    }

    const recordRes = await pool.query(
        'SELECT amount_paid FROM credpass.repayment_records WHERE wallet_address = $1',
        [walletAddress]
    );

    const records = recordRes.rows;
    const count = records.length;
    const total = records.reduce((sum, r) => sum + parseFloat(r.amount_paid), 0);
    const avg = count > 0 ? total / count : 0;

    // Explicit rules - never derived from client input
    let tier = 'C';
    if (count >= 3 && total >= 5000 && avg >= 1500) {
        tier = 'A';
    } else if (count >= 1 && total >= 1000 && avg >= 500) {
        tier = 'B';
    }
    // If no eligible records or weak records, tier remains C

    const lendingParams = {
        maxLoanUSD: tier === 'A' ? 50000 : tier === 'B' ? 15000 : 2000,
        ratePercent: tier === 'A' ? 3.5 : tier === 'B' ? 8.0 : 18.0,
    };

    return { tier, count, totalPaidUSD: total, averagePaidUSD: avg, lendingParams };
}

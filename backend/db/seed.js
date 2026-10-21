import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://credpass:credpass@localhost:5432/credpass';

const DEMO_ADDRESSES = [
    '0x1234567890123456789012345678901234567890',
    '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    '0x9876543210987654321098765432109876543210',
];

const SEED_DATA = [
    { wallet: DEMO_ADDRESSES[0], amount: 5000, currency: 'USD' },
    { wallet: DEMO_ADDRESSES[0], amount: 3200, currency: 'USD' },
    { wallet: DEMO_ADDRESSES[0], amount: 1200, currency: 'USD' },
    // Demo address 1: strong repayment history -> Tier A potential
    { wallet: DEMO_ADDRESSES[1], amount: 150, currency: 'USD' },
    // Demo address 2: weak history -> lower tier
    { wallet: DEMO_ADDRESSES[2], amount: 8000, currency: 'USD' },
    { wallet: DEMO_ADDRESSES[2], amount: 9500, currency: 'USD' },
    // Demo address 3: moderate -> Tier B potential
];

async function seed() {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
        await client.query('BEGIN');
        for (const d of DEMO_ADDRESSES) {
            await client.query('INSERT INTO credpass.borrowers (wallet_address) VALUES ($1) ON CONFLICT DO NOTHING', [d]);
        }
        for (const r of SEED_DATA) {
            await client.query(
                'INSERT INTO credpass.repayment_records (wallet_address, amount_paid, currency) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                [r.wallet, r.amount, r.currency]
            );
        }
        await client.query('COMMIT');
        console.log('Synthetic repayment records inserted:', SEED_DATA.length);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Seed failed:', e.message);
        throw e;
    } finally {
        await client.end();
    }
}

seed();

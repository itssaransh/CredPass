-- Cloudflare D1 schema (SQLite dialect).
-- Mirrors backend/db/init.sql (Postgres) but without the credpass.* schema
-- prefix, which D1 does not support.
--
-- Apply with:
--   npx wrangler d1 execute credpass-db --remote --file=backend/db/d1-schema.sql

CREATE TABLE IF NOT EXISTS borrowers (
    wallet_address TEXT PRIMARY KEY,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS repayment_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address TEXT NOT NULL REFERENCES borrowers(wallet_address) ON DELETE CASCADE,
    amount_paid REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'verified',
    tx_hash TEXT,
    -- Idempotency key for the demo seed only (NULL for real records).
    seed_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_repayment_wallet ON repayment_records(wallet_address);
CREATE INDEX IF NOT EXISTS idx_repayment_recorded ON repayment_records(recorded_at);

-- On-chain repayment provenance: tx_hash is NULL for seeded/synthetic rows and
-- unique for verified on-chain repayments (dedup key for /repayments/record).
-- SQLite allows multiple NULLs in a UNIQUE index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_repayment_tx ON repayment_records(tx_hash);

-- Seed rows are deduplicated by seed_key; real rows leave it NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_repayment_seed ON repayment_records(seed_key);

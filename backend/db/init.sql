CREATE SCHEMA IF NOT EXISTS credpass;

CREATE TABLE IF NOT EXISTS credpass.borrowers (
    wallet_address VARCHAR(42) PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credpass.repayment_records (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(42) NOT NULL REFERENCES credpass.borrowers(wallet_address) ON DELETE CASCADE,
    amount_paid DECIMAL(18, 6) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source VARCHAR(50) DEFAULT 'verified'
);

CREATE INDEX IF NOT EXISTS idx_repayment_wallet ON credpass.repayment_records(wallet_address);
CREATE INDEX IF NOT EXISTS idx_repayment_recorded ON credpass.repayment_records(recorded_at);

-- On-chain repayment provenance: tx_hash is null for seeded/synthetic rows and
-- unique for verified on-chain repayments (dedup key for /repayments/record)
ALTER TABLE credpass.repayment_records ADD COLUMN IF NOT EXISTS tx_hash VARCHAR(66);
CREATE UNIQUE INDEX IF NOT EXISTS idx_repayment_tx ON credpass.repayment_records(tx_hash);

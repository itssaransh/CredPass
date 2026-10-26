-- Idempotent demo data for the deployed Worker (Cloudflare D1).
-- Uses seed_key (UNIQUE) so this file can be re-run safely without duplicating
-- or skipping rows. Real on-chain repayments leave seed_key NULL.
--
-- Apply with:
--   npx wrangler d1 execute credpass-db --remote --file=backend/db/d1-seed.sql

-- 0xf39F...2266 is Hardhat account #0 (the default MetaMask dev account) -> Tier A.
INSERT INTO borrowers (wallet_address) VALUES ('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266') ON CONFLICT DO NOTHING;
INSERT INTO repayment_records (wallet_address, amount_paid, currency, seed_key) VALUES ('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 5000, 'USD', 'seed:0xf39f:1') ON CONFLICT (seed_key) DO NOTHING;
INSERT INTO repayment_records (wallet_address, amount_paid, currency, seed_key) VALUES ('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 3200, 'USD', 'seed:0xf39f:2') ON CONFLICT (seed_key) DO NOTHING;
INSERT INTO repayment_records (wallet_address, amount_paid, currency, seed_key) VALUES ('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 1200, 'USD', 'seed:0xf39f:3') ON CONFLICT (seed_key) DO NOTHING;

-- 0x7099...79C8 is Hardhat account #1 (well-known dev key) -> Tier A.
INSERT INTO borrowers (wallet_address) VALUES ('0x70997970C51812dc3A010C7d01b50e0d17dc79C8') ON CONFLICT DO NOTHING;
INSERT INTO repayment_records (wallet_address, amount_paid, currency, seed_key) VALUES ('0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 5000, 'USD', 'seed:0x70997970:1') ON CONFLICT (seed_key) DO NOTHING;
INSERT INTO repayment_records (wallet_address, amount_paid, currency, seed_key) VALUES ('0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 3200, 'USD', 'seed:0x70997970:2') ON CONFLICT (seed_key) DO NOTHING;
INSERT INTO repayment_records (wallet_address, amount_paid, currency, seed_key) VALUES ('0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 1200, 'USD', 'seed:0x70997970:3') ON CONFLICT (seed_key) DO NOTHING;

-- API demo wallet -> Tier A.
INSERT INTO borrowers (wallet_address) VALUES ('0x1234567890123456789012345678901234567890') ON CONFLICT DO NOTHING;
INSERT INTO repayment_records (wallet_address, amount_paid, currency, seed_key) VALUES ('0x1234567890123456789012345678901234567890', 5000, 'USD', 'seed:0x1234:1') ON CONFLICT (seed_key) DO NOTHING;
INSERT INTO repayment_records (wallet_address, amount_paid, currency, seed_key) VALUES ('0x1234567890123456789012345678901234567890', 3200, 'USD', 'seed:0x1234:2') ON CONFLICT (seed_key) DO NOTHING;
INSERT INTO repayment_records (wallet_address, amount_paid, currency, seed_key) VALUES ('0x1234567890123456789012345678901234567890', 1200, 'USD', 'seed:0x1234:3') ON CONFLICT (seed_key) DO NOTHING;

-- Moderate history -> Tier B.
INSERT INTO borrowers (wallet_address) VALUES ('0x9876543210987654321098765432109876543210') ON CONFLICT DO NOTHING;
INSERT INTO repayment_records (wallet_address, amount_paid, currency, seed_key) VALUES ('0x9876543210987654321098765432109876543210', 8000, 'USD', 'seed:0x9876:1') ON CONFLICT (seed_key) DO NOTHING;

-- Weak history -> Tier C.
INSERT INTO borrowers (wallet_address) VALUES ('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd') ON CONFLICT DO NOTHING;
INSERT INTO repayment_records (wallet_address, amount_paid, currency, seed_key) VALUES ('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', 150, 'USD', 'seed:0xabcd:1') ON CONFLICT (seed_key) DO NOTHING;

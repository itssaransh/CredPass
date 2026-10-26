# CredPass

A privacy-first, wallet-linked **credit passport prototype**: off-chain credit evaluation (Postgres-backed repayment ledger) signs **EIP-712 credentials** that unlock loans from an on-chain lending pool. On-chain repayments are verified by the backend (tx-receipt parsing, never client input) and lift your credit tier over time.

Full architecture deep-dive: [`DESIGN.md`](./DESIGN.md). Executed test evidence: [`E2E_TEST_REPORT.md`](./E2E_TEST_REPORT.md).
Contract reference: [`contracts/DEPLOY_REF.md`](./contracts/DEPLOY_REF.md).

## Architecture at a glance

| Layer | Tech | Where | Port |
|---|---|---|---|
| Frontend | React 19 + Vite 8 | repo root (`src/`) | 5173/5174 (dev) |
| Backend API | Express (ESM) | `backend/server.js` | 4000 |
| Contracts | Hardhat 2.28, Solidity 0.8.28, `CredPassLendingPool` | `contracts/` | 8545 node, chainId **31337 (0x7a69)** |
| Database | Postgres (docker, `docker-compose.yml` — Redis/Mongo were cut, item 13) | `backend/db/init.sql` | 5432 |
| Cloud deployment | Cloudflare Worker + D1 + Static Assets | `backend/worker/`, `wrangler.toml` | https |

## Deploy (Cloudflare Workers)

**Live:** <https://credpass.credpass-app.workers.dev>

A single Worker serves the built React app **and** the API. The API is available
at both `/api/*` (what the frontend calls) and the unprefixed paths (`/health`,
`/credentials/issue`, …). The cloud database is **Cloudflare D1**; local
development still uses Postgres — they are independent databases.

```bash
npm run deploy        # build the frontend + deploy the Worker (use this after code changes)
npm run deploy:db     # create/update the D1 schema (safe to re-run)
npm run deploy:seed   # idempotent demo repayment data
npm run deploy:full   # deploy:db + deploy:seed + deploy
npm run deploy:dev    # build + `wrangler dev` for a local Worker preview
```

First-time setup (already done for the live deployment):

```bash
npx wrangler login
npx wrangler d1 create credpass-db   # copy database_id into wrangler.toml
npm run deploy:db && npm run deploy:seed && npm run deploy
```

Optional secrets / configuration:

```bash
npx wrangler secret put EVALUATOR_PRIVATE_KEY   # must match the deployed evaluator
npx wrangler secret put RPC_URL                 # public HTTPS RPC (Alchemy/Infura/...)
# POOL_ADDRESS can go in [vars] in wrangler.toml
```

Without `RPC_URL`/`POOL_ADDRESS` the deployment is fully functional for credit
evaluation and EIP-712 credential issuance, but chain-dependent features
degrade by design: the faucet stays 403 (local-only) and
`/repayments/record` returns 503. On-chain borrow/repay/deposit still require a
deployed `CredPassLendingPool` plus MetaMask on the network configured in
`src/useWallet.js` (local Hardhat, chainId 31337).

> ⚠️ **Key hygiene:** if `EVALUATOR_PRIVATE_KEY` is not set, the Worker falls
> back to the repo's deterministic *local dev* key so signatures match the
> local Hardhat deployment. Do not use that fallback for a public chain — set a
> real secret first (and deploy the contract with the matching evaluator).

**Trust model (important):**

- The tier is computed **only** by `backend/services/evaluation.js` from DB records. The client never sends a tier.
- `/repayments/record` verifies the tx receipt on-chain (a `LoanRepaid` event from the **active** pool for that wallet) before it touches the DB. Tx-hash dedup prevents double-crediting.
- Loan tier limits/rates live **in the contract** (`tierLimits` / `tierRates`); the UI reads them from the chain (with constants only as a pre-read fallback).
- Concept glossary: **credential** = EIP-712 signed `{tier, userAddress}` hash (deterministic; same tier + wallet always same `tierHash`); **replay protection** = `usedCredentials[hash]`, but re-borrowing with the same credential is allowed when the matching stored loan (issued with that exact hash) is fully repaid.

## Quick start (fresh machine, in exact order)

Requirements: Node 24+, Docker Desktop, Git. No MetaMask needed until the browser step.

```bash
# 0. install everything
npm install && cd backend && npm install && cd ../contracts && npm install && cd ..

# 1. database (the only required service)
docker compose up -d
# create schema (idempotent):
docker exec -i credpass-postgres-1 psql -U credpass -d credpass < backend/db/init.sql
# optional demo repayment rows (node script, prints nothing to the DB ledger otherwise):
node backend/db/seed.js

# 2. local chain (keep this terminal open)
npm run dev:node

# 3. deploy + auto-write contracts/config/deploy-local.json (new terminal)
cd contracts && npx hardhat compile && npx hardhat run scripts/deploy.cjs --network localhost && cd ..

# 4. fund the pool (script inside the e2e run does 5 ETH, or manually:)
cd contracts && npx hardhat run scripts/e2e-local.cjs --network localhost && cd ..

# 5. backend (new terminal)
npm run dev:backend

# 6. frontend (new terminal)
npm run dev
```

Or all long-running processes at once (after steps 0–2 + deploy): `npm run dev:all` (node, backend, web).

### MetaMask setup

1. Add network manually: name `Hardhat Local`, RPC `http://127.0.0.1:8545`, chainId `31337`, currency `ETH` (Dev UI accepts `0x7a69`).
2. Import an account: the node's pre-funded keys are public (`hardhat node` prints them). Or fund your own address from the `contracts/` dir: `FUND_TARGET=0xYourAddress npx hardhat run scripts/fund-address.cjs --network localhost` (PowerShell: `$env:FUND_TARGET='0x...'` first).
3. The app detects the network; a **Get test ETH** button appears in the header once connected to the local chain (backend faucet, 0.5 ETH, max 10/h, local-node-only).

### Browser verification flow (manual, by design)

MetaMask cannot be driven by Playwright in this prototype; the extension flow is done by a human and is always labeled **manual** in the report:

`Connect Wallet` → `Get Credit Credential` (backend signs tier) → review contract-read loan terms → `Borrow ETH` → `Repay Loan` (sends principal + interest) → the app asks the backend to record the repayment → tier/progress bar updates.

**Depositor yield (item 10):** pool deposits are booked in a depositor registry; every loan repayment distributes its interest (repaid amount − principal) proportionally to depositors. A **Deposit into Pool** input/button in the "Pool & Loan State" panel lets you add an LP deposit; each wallet's accrued-but-unclaimed yield shows as "Your Accrued Yield" with a **Claim interest** button (`earned()` view + `claim()` transaction). Prototype caveats (per-repayment proportional split, not time-weighted shares) are documented in `contracts/DEPLOY_REF.md`.

## Tests (run these after any change)

```bash
npm run test:contracts   # 21 hardhat unit tests (own in-process network)
npm run test:e2e         # Phases A–G, 43 checks; funds the pool if needed
cd contracts && npx hardhat run scripts/flow-check.cjs --network localhost  # borrow→repay→record→re-issue loop
npm run test:backend     # static endpoint guard tests + faucet integration (needs backend + node running)
npm run build            # frontend production build
npx playwright test      # 2 browser smoke tests (needs `npm run dev` on 5173)
```

## Environment & configuration

- `contracts/config/deploy-local.json` is the **single source of truth** for the active contract/evaluator/chain/rpc. Written automatically by the deploy script; re-read from disk per request by the backend (redeploys apply live) and imported by the frontend.
- `backend/.env` is optional — the server runs on documented defaults (Postgres `credpass:credpass@localhost:5432/credpass`, `PORT=4000`, `ETH_USD_PRICE=2750`). Honestly: `dotenv` is not wired into `server.js`, so variables work when exported in the environment. `EVALUATOR_PRIVATE_KEY` MUST derive the deployed evaluator address (`0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A` with the repo's deterministic dev key) — omit it to use the fallback. `FAUCET_PRIVATE_KEY` falls back to the public Hardhat account #0 key and is guarded to local chainId 31337 only.
- Evaluator identity check: `0x19E7...ff2A` must equal `evaluatorAddress` in `deploy-local.json`.

## Known limitations / next steps

Detailed roadmap: [`IMPROVEMENT_PLAN.md`](./IMPROVEMENT_PLAN.md). Done: Batch 1 (faucet, contract-read tier terms, tier progress, friendly errors, `.env` hygiene, orchestration) and all Batch-2 items — 8 (owner-set tier params + chain-read backend terms), 10 (depositor interest shares: `earned()`/`claim()`), 11 (credential freshness `issuedAt` with 24h expiry), 12 (issue rate limiting), 13 (Redis/Mongo removed), 14 (supertest-style integration tests incl. the stale-config regression case), 15 (CI). Loan terms decided: keep open-ended (no due date), documented in `DESIGN.md`.

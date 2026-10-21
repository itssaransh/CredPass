# CredPass Implementation Plan

Written: 2026-10-21. Purpose: hand off the next iterations to a fresh session with zero prior context.

---

## 0. Current state (verified working — do not regress)

### Architecture
- **Frontend** (project root): React 19 + Vite 8 (`src/App.jsx`, `src/useWallet.js`, `src/CredentialFlow.jsx`). Dev server on **localhost:5173 / 5174** (`npm run dev`). Production build: `npm run build`. `/api/*` is proxied to the backend by `vite.config.js`.
- **Backend** (`backend/`): Express (`server.js`), ESM. Runs `node server.js` on **localhost:4000**. Endpoints:
  - `GET /health` → `{status, database}`
  - `POST /credentials/issue` `{userAddress}` → EIP-712 credential (tier computed by `backend/services/evaluation.js` from Postgres; client tier is NEVER accepted)
  - `POST /repayments/record` `{userAddress, txHash}` → verifies the tx receipt on-chain contains a `LoanRepaid` event emitted by the ACTIVE pool contract for that wallet; inserts into `credpass.repayment_records` with **tx-hash dedup** (NULL tx_hash allowed for seed rows); converts ETH → USD at `ETH_USD_PRICE` (default 2750); returns recomputed evaluation.
- **Contracts** (`contracts/`): Hardhat 2.28, Solidity 0.8.28, contract `CredPassLendingPool.sol`. Local node: `npx hardhat node` on `127.0.0.1:8545`, chainId 31337 (`0x7a69`).
- **Databases** (docker-compose): Postgres **5432** (`credpass:credpass`, db `credpass`, schema `credpass`, tables `borrowers`, `repayment_records`, migration in `backend/db/init.sql`), Redis **6379** (UNUSED), Mongo **27017** (UNUSED).

### Shared deployment config (single source of truth)
- `contracts/config/deploy-local.json` → `{contractAddress, evaluatorAddress, chainId, rpcUrl}`.
- It is the contract address used by: the E2E runner, the backend (re-read from disk **per request** — do not cache at boot), and the frontend (imported as JSON in `App.jsx`).
- Deploying: `cd contracts && npx hardhat run scripts/deploy.cjs --network localhost` — **auto-writes the deployed address into the config file**. After any redeploy you must fund the new pool (the E2E run does: 5 ETH).
- Deploys so far on this node: `0x5FbDB...`-style deterministic sequence has reached `0x610178dA211FEF7D417bC0e6FeD39F05609AD788` (current active as of writing).

### Contract semantics (important to preserve)
- Credential: EIP-712 domain `{name: "CredPass", version: "1"}`, types `Credential(tier: string, userAddress: address)`. Hash is **deterministic** (tier + wallet).
- `verifyAndIssueLoan`: checks hash match → ecrecover vs `evaluator` → caller == userAddress → **active-loan check first** (`Active loan exists`) → replay check with allowance: re-borrow with the SAME credential is allowed only if the stored loan (`Loan.tierHash`) was issued with that exact hash AND is fully repaid; otherwise `Credential replay`. Then tier limit → liquidity → issues loan, marks `usedCredentials[hash]`.
- `Loan` struct: `{borrower, principal, repaymentDue, tier, repaid, tierHash}`. **`getLoan` returns exactly 5 values** (no tierHash) — changing that signature breaks the frontend ABI usage and E2E.
- Tier limits/rates hardcoded in constructor: A=5 ETH/3.5%, B=1.5 ETH/8%, C=0.2 ETH/18%.

### Hard constraints (do not break)
1. `backend/server.js` must **never contain the string `const { tier`** — `backend/test/manipulation.test.js` asserts its absence. It must contain `const { userAddress } = req.body` and `evaluateBorrower` and `EVALUATOR_PRIVATE_KEY`.
2. Core tiers: A needs ≥3 records, total ≥ $5,000, avg ≥ $1,500; B needs ≥1 record, total ≥ $1,000, avg ≥ $500; else C. Backed by `backend/services/evaluation.js` — minimum repayment (Tier C: 0.236 ETH ≈ $649) can never drop an existing avg below $500, so tiers realistically only improve.
3. Never print or embed private keys or `.env` contents. The backend runner uses the **fallback** dev key which derives the evaluator `0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A` (matches contract + deploy script). `backend/.env`'s `EVALUATOR_PRIVATE_KEY` is a *mismatched unused value* — see item 10 below.
4. Replay/e2e re-runnability: `contracts/scripts/e2e-local.cjs` auto-selects the first Hardhat signer whose credential hash is unused on the ACTIVE contract. Keep that.
5. Do not weaken tests or run the e2e against a stale address (always via `deploy-local.json`).

### Test suites (all green at time of writing — rerun after every change)
- `cd contracts && npx hardhat test` → **21 tests**
- `cd contracts && npx hardhat run scripts/e2e-local.cjs --network localhost` → Phases A–G, **43 checks**
- `cd contracts && npx hardhat run scripts/flow-check.cjs --network localhost` → scripted borrow→repay→record→re-issue loop (observed live C→B→A)
- `cd backend && node test/issue.test.js && node test/evaluation.test.js && node test/manipulation.test.js`
- project root: `npm run build`, `npx playwright test test/browser-basic.spec.js` (2 tests; 5173 must be running)
- Report/doc: `E2E_TEST_REPORT.md` is kept updated with real executed results; contract ref in `contracts/DEPLOY_REF.md`.

### Environment notes
- Docker: `docker-compose up -d` (postgres is long-running; run `backend/db/init.sql` idempotent migration against it via `docker exec -i credpass-postgres-1 psql -U credpass -d credpass`).
- MetaMask: user's account `0xd67e7e18867abdf4e07ac89041fdba64a0f0d528` on Hardhat Local has ~1 ETH. Funding helper: `contracts/scripts/fund-address.cjs` (`FUND_TARGET=0x... npx hardhat run scripts/fund-address.cjs --network localhost`).
- The browser/MetaMask flow is done by the user manually; Playwright cannot automate the real extension. Never claim it was automated.

---

## Batch 1 — UX polish + hygiene (NO contract changes, NO redeploy) ← RECOMMENDED START

> **STATUS 2026-10-21: Batch 1 items 1–6 are DONE and verified. Evidence in `E2E_TEST_REPORT.md` "Update — 2026-10-21 (Batch 1…)"**
> - Item 1 shipped: `POST /faucet/drip` (0.5 ETH, 10/h/address, localStorage-free in-memory limiter, guarded to localhost RPC + chainId 31337, fallback = public Hardhat account #0 dev key, `FAUCET_PRIVATE_KEY` override) + header **Get test ETH** button. Test: `backend/test/faucet.test.js` (dry: balance increase, 400 on bad input, 429 after 10).
> - Item 2 shipped: UI reads `tierLimits`/`tierRates` from chain; constants only labeled pre-read fallback.
> - Item 3 shipped: `progress {nextTier, requirements}` on `/credentials/issue` + `/repayments/record` (see `getTierProgress` in `backend/services/evaluation.js`); progress bars under the credential card.
> - Item 4 shipped: `friendlyTxError()` in `src/App.jsx` (rejection/4001, insufficient funds, replay, active loan, tier, liquidity, network; raw truncated to 140 chars).
> - Item 5 shipped: mismatched `.env` key line deleted (length of listed key never matched the deployed evaluator; deterministic fallback does). Honest caveat: backend has never loaded `.env` at runtime (no dotenv/--env-file) — documented in README.
> - Item 6 shipped: root scripts `dev:node/dev:backend/dev:web/dev:all/dev:db`, `test:contracts/test:e2e/test:backend`; concurrently added; README rewritten.
> - Item 7 (updated): `test/interactive.spec.js` was asserting a non-existent "Launch App" button and wallet state — rewritten as a wallet-less smoke; Playwright now 4/4. `browser-basic.spec.js` unchanged 2/2.
> - E2E runner fix included: Phase F check 7 (insufficient liquidity) was self-masking (assertion error caught as a revert) and the negative branch is unexercisable with the grown pool; runner now branches on live liquidity (revert assert when pool < A limit, else honest BLOCKED). Deterministic revert stays covered by the hardhat unit test. One-off settlement helper: `contracts/scripts/settleActiveLoan.cjs`.


### 1. Faucet for test ETH
- **Backend:** `POST /api/faucet/drip` `{userAddress}` (root path `/faucet/drip` like other endpoints): validate address; transfer 0.5 ETH from a funded Hardhat signer `(await ethers.getSigners())[0]`-equivalent — backend doesn't have hardhat, so use `ethers.Wallet(FAUCET_PRIVATE_KEY)`? NO — do not add keys. Better: the faucet endpoint shells out **not** needed; instead use a dev-only approach: reuse the evaluator hot wallet signer? That wallet holds no ETH. Cleanest: backend route builds `new Wallet(HARDHAT_ACCOUNT_0_KEY)`? violates "no keys in backend". 
  **Preferred design:** skip backend; add a frontend-only dev button "Get test ETH" that calls a tiny hardhat-managed route? Alternative accepted trade-off: put the faucet in the **frontend dev flow only** is impossible without key. 
  **Decision:** implement faucet as a backend endpoint using a **new throwaway dev key generated at startup** whose address is funded on-chain by the deploy flow: extend `contracts/scripts/deploy.cjs` (cheap) to send 0.05 ETH from hardhat account[0] to faucet EOA derived from an in-repo public dev constant key... complexity. **Simplest robust option:** backend rooute `/faucet/drip` returns `{todo: 'local only'}` and calls node RPC `hardhat_fundAccounts`? Not a user wallet. 
  **Final minimal:** give backend the role of faucet signer by reading `FAUCET_PRIVATE_KEY` from env with a default of hardhat account #0's well-known dev mnemonic key (it is public for local chains and already in the repo's conceptual scope). Document clearly "local node only". Drip max 0.5 ETH, rate-limited in-memory (10/h per address). Delivers goal without new keys beyond the public hardhat mnemonic dev key.
- **Frontend:** button near wallet label when `account && local`; disable after success with message; show new balance.
- **Tests:** hardhat-independent; add e2e check that `/faucet/drip` on a fresh address increases its balance; rate limit returns 429.

### 2. Contract-enforced tier terms in UI
- Remove hardcoded `TIER_MAP` in `src/App.jsx`; read `tierLimits(tier)` / `tierRates(tier)` from the deployed contract (ABI already loaded) after credential issuance; display bps → percent.
- Fallback to constant map only while chain read is pending. Acceptance: changing contract limits requires no UI change.

### 3. Credit progress toward next tier
- Backend: extend `/repayments/record` response (and optionally `/credentials/issue`) with `progress` object computed from `evaluation`: `{nextTier, requirements: [{label, have, need}]}`.
- Frontend: progress bar + bullet list under the credential card.

### 4. Friendly tx error translation
- `handleBorrow`/`handleRepay` catch blocks map codes/messages → short strings: 4001 user-denied; insufficient funds; `Credential replay` → "That credential was already used — refresh your credit credential"; `Active loan exists` → "Repay your active loan first"; wrong network; others truncated to first sentence. Keep full error behind `details` expandable? Keep simple: message + short raw string prefix.

### 5. Fix `.env` / key mismatch (docs, no secrets)
- `backend/.env` `EVALUATOR_PRIVATE_KEY` derives a different address than the actual signer — the code's fallback key is what matches the deployed evaluator. Replace the `.env` value with the correct dev key (do NOT echo it in chat/logs/report), or delete the line so the deterministic fallback is used; add a comment "must match deployed evaluator address 0x19E7...".
- Confirm `/credentials/issue` signer still matches; rerun backend tests + e2e.

### 6. Dev orchestration + README
- Root `package.json` scripts (workspaces not needed): `dev:node` (`hardhat node` in contracts), `dev:backend`, `dev:web`, and `dev:all` via `npm-run-all -p` (new devDependency) or `concurrently`.
- Rewrite `README.md`: run order (docker → init.sql/seed → hardhat node → deploy+fund → backend → frontend), MetaMask setup (chain 31337 RPC http://127.0.0.1:8545), test commands, architecture one-pager, glossary of concepts (credential, tier, replay protection).
- Acceptance: a fresh machine can go from clone → working app following only README commands.

### 7. Playwright coverage for batch-1 UI (no MetaMask)
- New spec asserting: on-chain panel picks up contract limits? (needs wallet to call issue — skip), but assert homepage renders, faucet button appears when connected? (not without wallet) — realistically: test `/faucet/drip` via API in a hardhat-attached node script instead. Update `test/browser-basic.spec.js` if layout changed names.
- Keep honest labeling in `E2E_TEST_REPORT.md` (browser/MetaMask = manual).

---

## Batch 2 — Protocol/structural (contract changes → redeploy required)

> **STATUS 2026-10-22: ALL Batch-2 items DONE — 8, 10, 11, 12, 13, 14, 15 (item 9 DECIDED + DEFERRED, open-ended stays). Two redeploys this session; active contract `0x59b670e9fA9D0A427751Af201D676719a970857b` (see `contracts/DEPLOY_REF.md`). Evidence in `E2E_TEST_REPORT.md` "Update — 2026-10-22 (Batch 2…)" and the 2026-10-22 items-10/14 section.**
> - Item 8 DONE: `owner` (deployer) + `setTierParams(tier, limit, rate)` owner-only with guards (non-empty tier, limit > 0, 1 ≤ rate ≤ 10000 bps); constructor defaults unchanged (A 5 ETH/350, B 1.5/800, C 0.2/1800). Backend `/credentials/issue` now reads `tierLimits/tierRates` from the chain and reports `lendingParams.source: "chain"` (graceful config fallback). Hardhat tests: owner-set + terms-in-effect + non-owner revert + guard cases. E2E: owner preflight check.
> - Item 9 DECISION (recorded 2026-10-22): loans stay **open-ended** — no due date, no late fee. `getLoan` keeps 5 values; Loan struct unchanged. Discipline: revisit only with a written economic design (see `contracts/DEPLOY_REF.md`).
> - Item 11 DONE: `Credential(string tier, address userAddress, uint256 issuedAt)` — expiry bound inside the signature; contract reverts `Credential issuedAt in future` / `Credential expired` past 1 day (`CREDENTIAL_MAX_AGE`). Backend uses the chain's latest block timestamp as issuedAt (local-clock fallback). E2E issuedAt presence check + "tampered issuedAt → hash mismatch" negative case; unit tests cover expiry + future + tamper. Consequence: every issuance produces a NEW hash; repay must use the hash stored on the loan — contract now compares to `Loan.tierHash`, and the frontend repay flow reads it via the public `loans(address)` getter.
> - Item 12 DONE: in-memory rate limit on `/credentials/issue` (20/min per client IP, 429 with JSON error). Faucet already rate-limited (10/h).
> - Item 13 DONE: Redis + Mongo removed from `docker-compose.yml`; containers removed; `.env` URLs dropped; README updated. Rate limiting stays in-memory.
> - Item 15 DONE: `.github/workflows/ci.yml` (node 24, postgres service) — compile → unit tests → init.sql → hardhat node → deploy → E2E → backend static + faucet (backend running) → **item-14 supertest integration suite** → build → playwright. MetaMask steps manual-only forever.
> - Item 10 DONE (second redeploy → `0x59b670e9fA9D0A427751Af201D676719a970857b`): depositor registry (`deposit()` + `receive()` booked into `deposits/totalDeposits/depositorList`), repay distributes interest (`msg.value - loan.principal`) proportionally into `interestCredit[]` + `totalInterestEarned`, `claim()` (nonReentrant, resets credit, `InterestClaimed`), `earned(address)` view, `InterestCredited/InterestClaimed` events. Hardhat suite grown to **31 tests (31/31 PASS)** incl. proportional split (25%/75%), claim-liquidity invariant, unclaimed-interest-stays-in-pool. E2E grew to **50 PASS / 0 FAIL / 1 BLOCKED** with item-10 Phase E checks (pool interest = due − principal, proportional credit, live claim verified on-chain). Frontend: "Your Accrued Yield" + Claim interest button in the Pool panel (reuses `friendlyTxError`), plus a "Deposit into Pool" input + button so deposit → accrue → claim is fully testable in the browser. Caveats recorded in `contracts/DEPLOY_REF.md` (O(depositors) loop, floor dust, claim-vs-borrowable-liquidity).
> - Item 14 DONE: `backend/test/integration.test.js` — supertest spins the exported Express `app` (listener guarded by `NODE_ENV !== 'test'`; tests MUST set `NODE_ENV=test` before importing `../server.js`) on an ephemeral port; real local Postgres; chain-dependent cases skip gracefully when node/deploy-local.json is absent. **15/15 PASS**, including the named **stale-config regression** (fake contract address in `deploy-local.json` → per-request re-read proven behaviorally: 404 loan-stage vs 503 contract-read) and rate-limit engagement (429). Added to root `test:backend`. Note: `server.js` now exports `{ app }`.
> - Fresh node note (session event): the Hardhat node died with a machine restart; new deployment `0x5FbDB2315678afecb367f032d93F642f64180aa3` (deterministic first slot). Old addresses retired; MetaMask may need re-approval of the new contract address and re-add of the network after any node restart NOTE (2026-10-22 evening): node restarted AGAIN for a MetaMask-UX fix — interval mining (1 s) caused spurious "Transaction failed" toasts on every confirmed tx (verified successful on-chain each time); switched `networks.hardhat.mining` to instant (`auto: true, interval: 0`), redeployed (`0x5FbDB231…80aa3`), e2e 50 PASS / 0 FAIL / 1 BLOCKED, flow-check PASS. Chain resets: on-chain state (deposits/loans) resets with the node; Postgres credit history persists.


Each item: contract change → recompile → redeploy (auto-writes `deploy-local.json`) → fund pool (e2e) → update tests (they will break — fix them) → rerun all suites → update `E2E_TEST_REPORT.md` + `contracts/DEPLOY_REF.md`.

### 8. Single source of truth for tier params
- Contract: add `owner` (immutable deployer or settable), `setTierParams(tier, uint256 limit, uint256 rate)` owner-only with sane guards (rates in bps, limits > 0). Initialize from constructor constants for compat.
- Backend `/credentials/issue`: query `tierLimits/tierRates` from chain (via JsonRpcProvider) instead of hardcoded `lendingParams` map; keep DB-driven thresholds in `evaluation.js` unchanged.
- Frontend already follows (item 2).
- Update hardhat tests: add owner-set + non-owner-revert cases. AE2E: after deploy, e2e Phase D asserts limit consistency with contract values regardless of defaults.

### 9. Loan duration / due date model (DESIGN DECISION BEFORE CODING)
- Options: (a) fixed-duration term with due timestamp + late fee; (b) duration chosen by tier; (c) open-ended as today.
- Contract impact: `Loan` gains `issuedAt`/`dueAt`; `repay` computes (or ignores) late fee; `getLoan` signature WILL change (coordinate frontend + e2e + tests + flow-check).
- Requires product decision on: what happens on due date (revert? surcharge? mark default → lose credential). Write the decision in `E2E_TEST_REPORT.md` or a new `DESIGN.md` section before implementing.

### 10. Depositor economics (LP shares)
- Minimal: track `uint256 totalInterestEarned` + `mapping(address => user interest in-balance)` on repay; add `claim()` for interest share? True LP shares need share issuance by tier of deposit time — start with full-pool proportional share of interest, stored in a simple `interestCredit[depositor]` updated per repay.
- Keep `receive()`/`deposit()` semantics; expose `earned(address)` view; tests: interest accrual after Ni repayments proportional to deposits; claim transfers without breaking liquidity math.
- Frontend: small "Pool" section update (yield shown) — only if time permits.

### 11. Credential freshness (issuedAt/expiry in signed struct)
- Add `issuedAt` to `Credential` struct (backend supplies block.timestamp); contract `verifyAndIssueLoan` requires `block.timestamp - issuedAt <= maxAge` (e.g. 1 day). Backend changes: domain/types/value; frontend unchanged except tierHash changes automatically (old hashes invalid — fine).
- NB: expiry value must be part of the signed struct (NOT a side field) or it doesn't bind. Deploy + all suites; e2e gets a new negative case: tampered issuedAt → revert.

### 12. Rate limiting + hardening on backend
- `/credentials/issue` signs with a hot key per request — add simple in-memory rate limit (e.g. 20/min/IP) and JSON error shape consistency; optional Redis later (with item below).

### 13. Use or cut Redis/Mongo
- Decide: cut from `docker-compose.yml` OR use (Redis = rate-limit counters / short-lived credential cache; Mongo = raw event/audit log from `/repayments/record`). Changing compose affects `.env` guidance in README.

### 14. Real backend integration tests
- Replace string-matching tests with `supertest`-style integration: spin the Express app (export `app` from `server.js` guarded by `if (process.env.NODE_ENV !== 'test')`) and hit `/credentials/issue` with fake DB (pg-mem or a test schema), `/repayments/record` against the local hardhat contract (guarded, skips gracefully if node absent).
- Add the **stale-config regression case** as a named test (config file re-read per request — the bug found and fixed this session).

### 15. CI
- GitHub Actions (or any runner): `node:24`, steps: install → compile → hardhat test → hardhat node + deploy + e2e → backend tests → build → playwright basic (Vite dev on 5173). Mark MetaMask-gated steps manual-only forever.

---

## Execution order guidance
1. Batch 1 items 1–6 (skip 7 unless UI changed beyond copy).
2. Validate with the full suite battery in §0; update `E2E_TEST_REPORT.md` with a new dated section.
3. Batch 2 in the order 8 → 11 → 12/13/14/15 → 10 → 9 (9 last: economic design needs deliberation).
4. Every redeploy: run deploy script (config auto-updated), then e2e (funds pool), then backend suite, then build, then playwright smoke. Tell the user to refresh the page and approve the new contract address in MetaMask — the UI reads the address from `deploy-local.json` automatically.
5. House rules: never expose keys; never reset DB; never run suites against stale addresses; keep assertions strong; incidentally: keep `usedCredentials` replay allowance semantics intact when refactoring (Loan.tierHash allowance).

## Open questions to confirm with the user before Batch 2
- Loan terms decided for item 9 (duration/late policy)?
- Keep Redis/Mongo or cut (item 13)?
- Is there appetite for upgrading to a wallet-less "credit registry" model (deposits become tokenized LP positions)? — stretches beyond current prototype; note only.

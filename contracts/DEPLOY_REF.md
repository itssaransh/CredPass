# CredPass Contract Deployment Reference

## Active deployment (chains 31337 local)

`contracts/config/deploy-local.json` is the single source of truth (written automatically by `scripts/deploy.cjs`, re-read per request by the backend, imported by the frontend):

```json
{
  "contractAddress": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "evaluatorAddress": "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
  "chainId": "0x7a69",
  "rpcUrl": "http://127.0.0.1:8545"
}
```

Deployed **2026-10-22** (fourth local deployment — fresh node, now **instant mining**). Retired addresses: `0x610178dA211FEF7D417bC0e6FeD39F05609AD788` (1st node), `0x5FbDB231…80aa3` values from 2nd/4th nodes collide (deterministic first slot — always check `deploy-local.json`, never assume), `0x59b670e9fA9D0A427751Af201D676719a970857b` (3rd node, 2nd/3rd deployments).

**Node config change (2026-10-22):** `hardhat.config.cjs` now sets `networks.hardhat.mining = { auto: true, interval: 0 }` — instant mining. Reason: with the previous 1 s interval mining, MetaMask fired spurious "Transaction failed" toasts for every confirmed tx (known MetaMask fast/interval-mining tx-state race; all txs verified successful on-chain). Instant mining mines the tx before MetaMask's confirmation UI polls, eliminating the race.

## Deploy procedure

```
cd contracts
npx hardhat node            # separate terminal (or npm run dev:node from repo root)
npx hardhat run scripts/deploy.cjs --network localhost
```

The deploy script auto-persists the new address into `deploy-local.json`. Fresh deployments hold **0 liquidity** — fund the pool via the e2e run (`npx hardhat run scripts/e2e-local.cjs --network localhost`, sends 5 ETH) or `deposit()`.

## Contract semantics (as of this deployment)

- **CredPassLendingPool.sol** (Solidity 0.8.28, viaIR, optimizer 200).
- EIP-712 domain `{name: "CredPass", version: "1"}`, type `Credential(string tier, address userAddress, uint256 issuedAt)` — **item 11**: `issuedAt` is signed INSIDE the struct; `verifyAndIssueLoan` reverts `Credential issuedAt in future` / `Credential expired` when `block.timestamp - issuedAt > 1 days` (constant `CREDENTIAL_MAX_AGE`). Each issuance (new `issuedAt`) yields a new unique `tierHash`.
- **Item 8**: `owner` = deployer; `setTierParams(tier, limit, rate)` owner-only (guards: non-empty tier, limit > 0, 1 ≤ rate ≤ 10000 bps). Constructor still initializes A=5 ETH/350, B=1.5 ETH/800, C=0.2 ETH/1800. Backend `/credentials/issue` reads `tierLimits`/`tierRates` from the chain and reports `source: "chain"`.
- `verifyAndIssueLoan(tier, userAddress, issuedAt, tierHash, signature)`: hash match → ecrecover vs evaluator → freshness → caller == wallet → tier checks → active-loan check first (`Active loan exists`) → replay with allowance (same hash re-usable only after the loan it issued is fully repaid) → tier limit → liquidity → issues loan. Loan is always the FULL tier limit (no amount param).
- `repay(tierHash)` compares against the **stored** `Loan.tierHash` (hash includes `issuedAt`, so it cannot be recomputed from tier+wallet alone).
- `getLoan` still returns exactly **5 values** (no tierHash) — ABI compatibility contract for the frontend and E2E; the full struct is reachable via the public `loans(address)` getter (the frontend repay flow uses it to fetch the issuing hash).
- Loan model: **open-ended** — no due date / late fees (product decision recorded 2026-10-22 in `DESIGN.md`; item 9 deferred).
- Loan struct (public `loans()`): `{borrower, principal, repaymentDue, tier, repaid, tierHash}`.
- **Item 10 — depositor economics (LP interest shares)**: every external funding path (`deposit()` and the `receive()` fallback) is booked in a depositor registry (`deposits`, `totalDeposits`, `depositorList`, `isDepositor`). On every `repay()`, the interest amount (`msg.value - loan.principal`, always positive since `repaymentDue = principal * (10000 + rate) / 10000`) is distributed **proportionally to each depositor's share of `totalDeposits` at repayment time** into `interestCredit[depositor]` and counted in `totalInterestEarned` (`InterestCredited` events). `claim()` (nonReentrant) withdraws the full accrued credit, resets it, and emits `InterestClaimed`; `earned(address)` is the view for accrued-but-unclaimed interest. The frontend "Pool & Loan State" panel shows "Your Accrued Yield" with a **Claim interest** button (`claimTx` → `friendlyTxError` mapping, disabled at 0).
  - Prototype caveats (accepted): proportional split recalculated per repayment from current deposit shares (not time-weighted shares); O(depositors) loop per repayment; floor-rounding dust stays in the pool; a claim while a loan keeps principal outstanding can temporarily reduce borrowable liquidity below `tierLimits` — borrows still guard with `Insufficient liquidity`.
  - Note: the deployer's initial plain-ETH funding is booked as a depositor share (via `receive()`), which is the desired semantics for this prototype.

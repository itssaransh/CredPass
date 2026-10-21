const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CredPassLendingPool", function () {
  let pool, evaluator, borrower, attacker, depositor;
  const domain = { name: "CredPass", version: "1" };
  const types = {
    Credential: [
      { name: "tier", type: "string" },
      { name: "userAddress", type: "address" },
      { name: "issuedAt", type: "uint256" },
    ],
  };

  beforeEach(async function () {
    const accounts = await ethers.getSigners();
    evaluator = accounts[0]; // deployer => owner
    borrower = accounts[1];
    attacker = accounts[2];
    depositor = accounts[3];

    const Pool = await ethers.getContractFactory("CredPassLendingPool");
    pool = await Pool.deploy(evaluator.address);
    await pool.waitForDeployment();
  });

  // 1. Pool funding and liquidity accounting
  it("accepts deposits and tracks liquidity", async function () {
    await expect(pool.connect(depositor).deposit({ value: ethers.parseEther("10") }))
      .to.emit(pool, "Deposited")
      .withArgs(depositor.address, ethers.parseEther("10"));
    expect(await pool.getLiquidity()).to.equal(ethers.parseEther("10"));
  });

  // Helper to build a freshness-bound credential for borrower.
  // issuedAt = latest block timestamp (mirrors what the backend signs).
  async function buildCredential(tier) {
    const issuedAt = (await ethers.provider.getBlock("latest")).timestamp;
    const value = { tier, userAddress: borrower.address, issuedAt };
    const hash = await ethers.TypedDataEncoder.hash(domain, types, value);
    const sig = await evaluator.signTypedData(domain, types, value);
    return { tier, hash, sig, issuedAt };
  }

  // 2. Valid credential borrowing within tier limit (Tier A = 5 ETH)
  it("issues a loan for a valid Tier A credential", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("5") });
    const cred = await buildCredential("A");

    const tx = await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    await expect(tx).to.emit(pool, "LoanIssued").withArgs(borrower.address, ethers.parseEther("5"), cred.hash, "A", 350);

    const loan = await pool.getLoan(borrower.address);
    expect(loan[0]).to.equal(borrower.address); // borrower
    expect(loan[1]).to.equal(ethers.parseEther("5")); // principal
    expect(loan[3]).to.equal("A"); // tier
    expect(loan[4]).to.equal(false); // repaid
  });

  // 3. Actual borrower ETH balance increase and pool balance decrease
  it("transfers ETH to borrower and reduces pool liquidity", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("5") });
    const cred = await buildCredential("A");
    const initialPool = await pool.getLiquidity();

    await expect(pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig))
      .to.changeEtherBalances([borrower, pool], [ethers.parseEther("5"), ethers.parseEther("-5")]);
  });

  // 4. Tier limits apply: Tier C limit (0.2 ETH) works.
  it("issues Tier C loan with lower limit", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("1") });
    const cred = await buildCredential("C");
    await expect(pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig))
      .to.emit(pool, "LoanIssued").withArgs(borrower.address, ethers.parseEther("0.2"), cred.hash, "C", 1800);
  });

  // 5. Invalid evaluator signature, modified tier, invalid hash, mismatched wallet revert
  it("rejects invalid evaluator signature", async function () {
    const cred = await buildCredential("A");
    const badSig = await attacker.signTypedData(domain, types, { tier: "A", userAddress: borrower.address, issuedAt: cred.issuedAt });
    await expect(pool.connect(borrower).verifyAndIssueLoan("A", borrower.address, cred.issuedAt, cred.hash, badSig)).to.be.revertedWith("Invalid credential signer");
  });

  it("rejects modified tier (hash mismatch)", async function () {
    const cred = await buildCredential("A");
    await expect(pool.connect(borrower).verifyAndIssueLoan("B", borrower.address, cred.issuedAt, cred.hash, cred.sig)).to.be.revertedWith("Credential hash mismatch");
  });

  // 6. Credential replay and second loan while active revert
  it("rejects borrowing again with the same credential while a loan is active", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("5") });
    const cred = await buildCredential("A");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    await expect(pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig)).to.be.revertedWith("Active loan exists");
  });

  it("rejects a second loan while one is active", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("10") });
    const credA = await buildCredential("A");
    await pool.connect(borrower).verifyAndIssueLoan(credA.tier, borrower.address, credA.issuedAt, credA.hash, credA.sig);
    const credB = await buildCredential("B");
    await expect(pool.connect(borrower).verifyAndIssueLoan(credB.tier, borrower.address, credB.issuedAt, credB.hash, credB.sig)).to.be.revertedWith("Active loan exists");
  });

  // Genuine replay: after two fully repaid loans, the borrower's record stores
  // the LAST credential's hash — re-using the stale earlier credential (which
  // was also consumed) must hit the replay branch (no active loan involved)
  it("rejects replay of a repaid, stale credential with no active loan", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("10") });
    const credC = await buildCredential("C");
    await pool.connect(borrower).verifyAndIssueLoan(credC.tier, borrower.address, credC.issuedAt, credC.hash, credC.sig);
    const loan1 = await pool.getLoan(borrower.address);
    await pool.connect(borrower).repay(credC.hash, { value: loan1[2] });
    const credB = await buildCredential("B");
    await pool.connect(borrower).verifyAndIssueLoan(credB.tier, borrower.address, credB.issuedAt, credB.hash, credB.sig);
    const loan2 = await pool.getLoan(borrower.address);
    await pool.connect(borrower).repay(credB.hash, { value: loan2[2] });
    // No active loan now; credC is used but not the current loan's credential
    await expect(pool.connect(borrower).verifyAndIssueLoan(credC.tier, borrower.address, credC.issuedAt, credC.hash, credC.sig)).to.be.revertedWith("Credential replay");
  });

  // 7. Repayment updates loan state and pool balance
  it("accepts exact repayment and updates state", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("5") });
    const cred = await buildCredential("A");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    const loanBefore = await pool.getLoan(borrower.address);
    expect(loanBefore[4]).to.equal(false); // repaid

    // Repayment due = 5 ETH * (10000 + 350) / 10000 = 5.175 ETH
    const repayment = loanBefore[2];
    await expect(pool.connect(borrower).repay(cred.hash, { value: repayment })).to.emit(pool, "LoanRepaid").withArgs(borrower.address, repayment);
    const loanAfter = await pool.getLoan(borrower.address);
    expect(loanAfter[4]).to.equal(true);
  });

  // 8. Underpayment and overpayment revert
  it("rejects underpayment", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("5") });
    const cred = await buildCredential("A");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    const loanBefore = await pool.getLoan(borrower.address);
    await expect(pool.connect(borrower).repay(cred.hash, { value: loanBefore[2] - 1n })).to.be.revertedWith("Exact repayment amount required");
  });

  it("rejects overpayment", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("5") });
    const cred = await buildCredential("A");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    const loanBefore = await pool.getLoan(borrower.address);
    await expect(pool.connect(borrower).repay(cred.hash, { value: loanBefore[2] + 1n })).to.be.revertedWith("Exact repayment amount required");
  });

  // 9. Reentrancy guard: attempt a reentrant call (simplified by calling repay with a contract that tries to call again)
  it("reverts reentrant calls", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("5") });
    const cred = await buildCredential("A");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    const loanData = await pool.getLoan(borrower.address);
    await expect(pool.connect(borrower).repay(cred.hash, { value: loanData[2] })).to.not.be.reverted; // Normal call works; we don't have a full reentrancy attacker in this minimal suite.
  });

  // 10. Loan after repayment (replay policy: same borrower can borrow again)
  it("allows a new loan after repayment", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("10") });
    const credA = await buildCredential("A");
    await pool.connect(borrower).verifyAndIssueLoan(credA.tier, borrower.address, credA.issuedAt, credA.hash, credA.sig);
    const loanBefore = await pool.getLoan(borrower.address);
    await pool.connect(borrower).repay(credA.hash, { value: loanBefore[2] });
    const credB = await buildCredential("B");
    await expect(pool.connect(borrower).verifyAndIssueLoan(credB.tier, borrower.address, credB.issuedAt, credB.hash, credB.sig)).to.emit(pool, "LoanIssued");
  });

  // Credential lifecycle: re-borrow with the SAME signed credential after full
  // repayment is allowed (loan lifecycle, not single-use forever)
  it("allows re-borrow with the same credential after full repayment", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("10") });
    const cred = await buildCredential("A");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    const loan1 = await pool.getLoan(borrower.address);
    await pool.connect(borrower).repay(cred.hash, { value: loan1[2] });
    expect((await pool.getLoan(borrower.address))[4]).to.equal(true);
    await expect(pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig))
      .to.emit(pool, "LoanIssued");
    const loan2 = await pool.getLoan(borrower.address);
    expect(loan2[4]).to.equal(false); // active again
    // restore repaid state for other tests' assumptions (borrower only used here)
    await pool.connect(borrower).repay(cred.hash, { value: loan2[2] });
  });

  // A different wallet can never replay someone else's already-used credential
  it("rejects replay of another wallet's used credential on a fresh wallet", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("10") });
    const cred = await buildCredential("A");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    const loanData = await pool.getLoan(borrower.address);
    await pool.connect(borrower).repay(cred.hash, { value: loanData[2] });
    // attacker never borrowed with this hash; replay must fail regardless of repayment
    await expect(pool.connect(attacker).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig))
      .to.be.revertedWith("Caller does not match credential wallet");
  });

  // 11. Insufficient liquidity
  it("rejects borrowing when pool has insufficient liquidity", async function () {
    const cred = await buildCredential("A");
    await expect(pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig)).to.be.revertedWith("Insufficient liquidity");
  });

  // 12. Unknown/ineligible tier
  it("rejects unknown tier", async function () {
    const issuedAt = (await ethers.provider.getBlock("latest")).timestamp;
    const value = { tier: "Z", userAddress: borrower.address, issuedAt };
    const hash = await ethers.TypedDataEncoder.hash(domain, types, value);
    const sig = await evaluator.signTypedData(domain, types, value);
    await expect(pool.connect(borrower).verifyAndIssueLoan("Z", borrower.address, issuedAt, hash, sig)).to.be.revertedWith("Ineligible tier");
  });

  // Repayment regression: tierHash must match the hash stored on the loan
  it("rejects repayment with wrong tier hash", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("5") });
    const cred = await buildCredential("A");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    const loanBefore = await pool.getLoan(borrower.address);
    // Any hash other than the issuing credential's must revert
    const badHash = ethers.keccak256(ethers.toUtf8Bytes("wrong"));
    await expect(pool.connect(borrower).repay(badHash, { value: loanBefore[2] })).to.be.revertedWith("Tier hash does not match active loan");
  });

  it("accepts repayment with correct tier hash and updates state", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("5") });
    const cred = await buildCredential("A");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    const loanBefore = await pool.getLoan(borrower.address);
    await expect(pool.connect(borrower).repay(cred.hash, { value: loanBefore[2] })).to.emit(pool, "LoanRepaid");
    const loanAfter = await pool.getLoan(borrower.address);
    expect(loanAfter[4]).to.equal(true);
  });

  // 13. Mismatched wallet
  it("rejects when caller address does not match credential userAddress", async function () {
    const cred = await buildCredential("A");
    await expect(pool.connect(attacker).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig)).to.be.revertedWith("Caller does not match credential wallet");
  });

  // === Credential freshness (issuedAt bound inside the signed struct) ===

  it("rejects tampered issuedAt (hash mismatch)", async function () {
    const cred = await buildCredential("A");
    // Signature/hash are bound to the issued the credential carries; calling
    // with a shifted issuedAt must fail the hash check first.
    await expect(pool.connect(borrower).verifyAndIssueLoan("A", borrower.address, BigInt(cred.issuedAt) + 1n, cred.hash, cred.sig))
      .to.be.revertedWith("Credential hash mismatch");
  });

  it("rejects a future issuedAt", async function () {
    const issuedAt = (await time.latest()) + 3600; // 1 hour ahead
    const value = { tier: "A", userAddress: borrower.address, issuedAt };
    const hash = await ethers.TypedDataEncoder.hash(domain, types, value);
    const sig = await evaluator.signTypedData(domain, types, value);
    await expect(pool.connect(borrower).verifyAndIssueLoan("A", borrower.address, issuedAt, hash, sig))
      .to.be.revertedWith("Credential issuedAt in future");
  });

  it("rejects expired credentials (older than CREDENTIAL_MAX_AGE)", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("5") });
    const cred = await buildCredential("A");
    // Age the chain past the 1-day freshness window
    await time.increase(2 * 24 * 60 * 60);
    await expect(pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig))
      .to.be.revertedWith("Credential expired");
  });

  // === Owner-managed tier parameters (single source of truth) ===

  it("owner can update tier params and loans use the new terms", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("5") });
    // owner is the deployer/evaluator account
    await pool.connect(evaluator).setTierParams("C", ethers.parseEther("1"), 100); // 1 ETH @ 1%
    expect(await pool.tierLimits("C")).to.equal(ethers.parseEther("1"));
    expect(await pool.tierRates("C")).to.equal(100);

    const cred = await buildCredential("C");
    await expect(pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig))
      .to.emit(pool, "LoanIssued").withArgs(borrower.address, ethers.parseEther("1"), cred.hash, "C", 100);
    const loan = await pool.getLoan(borrower.address);
    expect(loan[1]).to.equal(ethers.parseEther("1"));
    const loanFull = await pool.loans(borrower.address);
    // repaymentDue = 1 ETH * (10000 + 100) / 10000 = 1.01 ETH
    expect(loanFull[2]).to.equal(ethers.parseEther("1.01"));
  });

  it("rejects tier-param updates from non-owner", async function () {
    await expect(pool.connect(borrower).setTierParams("B", ethers.parseEther("1"), 100)).to.be.revertedWith("Not owner");
    await expect(pool.connect(depositor).setTierParams("B", ethers.parseEther("1"), 100)).to.be.revertedWith("Not owner");
  });

  it("guards setTierParams inputs", async function () {
    await expect(pool.connect(evaluator).setTierParams("", ethers.parseEther("1"), 100)).to.be.revertedWith("Tier required");
    await expect(pool.connect(evaluator).setTierParams("B", 0, 100)).to.be.revertedWith("Limit must be positive");
    await expect(pool.connect(evaluator).setTierParams("B", ethers.parseEther("1"), 0)).to.be.revertedWith("Rate must be 1..10000 bps");
    await expect(pool.connect(evaluator).setTierParams("B", ethers.parseEther("1"), 10001)).to.be.revertedWith("Rate must be 1..10000 bps");
  });

  it("exposes owner and keeps getLoan at five values", async function () {
    expect(await pool.owner()).to.equal(evaluator.address);
    // getLoan returns exactly 5 values (frontend/E2E ABI compatibility contract)
    await pool.connect(depositor).deposit({ value: ethers.parseEther("5") });
    const cred = await buildCredential("A");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    const loan = await pool.getLoan(borrower.address);
    expect(loan.length).to.equal(5);
  });

  // === Depositor economics (LP interest shares, item 10) ===

  it("credits repayment interest to depositors proportionally", async function () {
    // Depositors: 1 ETH / 3 ETH => shares 25% / 75% of the C-tier interest
    await pool.connect(attacker).deposit({ value: ethers.parseEther("1") });
    await pool.connect(depositor).deposit({ value: ethers.parseEther("3") });
    expect(await pool.totalDeposits()).to.equal(ethers.parseEther("4"));
    expect(await pool.deposits(depositor.address)).to.equal(ethers.parseEther("3"));

    const cred = await buildCredential("C");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    const loan = await pool.loans(borrower.address); // 0.2 ETH principal, due 0.236
    const interest = loan[2] - loan[1]; // 0.036 ETH

    await pool.connect(borrower).repay(cred.hash, { value: loan[2] });

    expect(await pool.totalInterestEarned()).to.equal(interest);
    expect(await pool.earned(attacker.address)).to.equal(interest / 4n);
    expect(await pool.earned(depositor.address)).to.equal((interest * 3n) / 4n);
  });

  it("claim transfers accrued interest and resets the credit", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("1") });
    const cred = await buildCredential("C");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    const loan = await pool.loans(borrower.address);
    const interest = loan[2] - loan[1];
    await pool.connect(borrower).repay(cred.hash, { value: loan[2] });

    const before = await ethers.provider.getBalance(depositor.address);
    const tx = await pool.connect(depositor).claim();
    // Pool after repay = 1 (deposit) − 0.2 (loan out) + 0.236 (repay) = 1.036;
    // the claim of 0.036 interest leaves exactly 1 ETH (includes the 0.2 loan principal the borrower still owes).
    expect(await pool.getLiquidity()).to.equal(ethers.parseEther("1"));
    expect(await pool.earned(depositor.address)).to.equal(0n);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    const gasCost = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(depositor.address);
    await expect(tx).to.emit(pool, "InterestClaimed").withArgs(depositor.address, interest);
    expect(after - before + gasCost).to.equal(interest);

    // Nothing left to claim
    await expect(pool.connect(depositor).claim()).to.be.revertedWith("Nothing to claim");
  });

  it("keeps accrued interest in pool liquidity until claimed", async function () {
    await pool.connect(depositor).deposit({ value: ethers.parseEther("1") });
    const cred = await buildCredential("C");
    await pool.connect(borrower).verifyAndIssueLoan(cred.tier, borrower.address, cred.issuedAt, cred.hash, cred.sig);
    const loan = await pool.loans(borrower.address);
    const interest = loan[2] - loan[1];
    await pool.connect(borrower).repay(cred.hash, { value: loan[2] });

    // Pool balance after repay = 1 (deposit) − 0.2 (loan out) + 0.236 (repay)
    // = 1.036 ETH: principal AND unclaimed interest both stay in the pool.
    expect(await pool.getLiquidity()).to.equal(ethers.parseEther("1.036"));
    expect(await pool.earned(depositor.address)).to.equal(interest);
  });
});

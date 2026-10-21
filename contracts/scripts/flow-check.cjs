const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "deploy-local.json"), "utf8"));
const BACKEND_URL = "http://localhost:4000";

async function main() {
  const borrower = (await hre.ethers.getSigners())[1]; // 0x7099...
  const userAddress = borrower.address;
  const provider = new hre.ethers.JsonRpcProvider(config.rpcUrl);
  const pool = new hre.ethers.Contract(config.contractAddress, (await hre.artifacts.readArtifact("CredPassLendingPool")).abi, (await hre.ethers.getSigners())[0]);

  // 1. Current state
  const loan0 = await pool.getLoan(userAddress);
  console.log("Loan before flow:", JSON.stringify({
    borrower: loan0.borrowerAddr,
    repaid: loan0.repaidVal,
    tier: loan0.tierVal
  }));
  if (!(loan0.borrowerAddr === "0x0000000000000000000000000000000000000000" || loan0.repaidVal)) {
    throw new Error("Borrower still has an active loan; cannot run flow");
  }

  // 2. Fresh credential from backend (deterministic hash; replay-allowed after repayment)
  const credRes = await fetch(`${BACKEND_URL}/credentials/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userAddress })
  });
  const cred = await credRes.json();
  console.log("Credential tier:", cred.credential.tier, "| signer:", cred.signer);

  // 3. Borrow again (replay allowance after repayment)
  const borrowTx = await pool.connect(borrower).verifyAndIssueLoan(cred.credential.tier, userAddress, cred.credential.issuedAt, cred.tierHash, cred.signature);
  await borrowTx.wait();
  console.log("Borrow OK — tx:", borrowTx.hash);
  const loan1 = await pool.getLoan(userAddress);
  console.log("Active loan: principal", hre.ethers.formatEther(loan1.principal), "ETH, due", hre.ethers.formatEther(loan1.repaymentDueVal), "ETH");

  // 4. Repay exactly
  const repayTx = await pool.connect(borrower).repay(cred.tierHash, { value: loan1.repaymentDueVal });
  const repayReceipt = await repayTx.wait();
  console.log("Repay OK — tx:", repayTx.hash, "status:", repayReceipt.status);

  // 5. Record repayment in the credit ledger
  const recRes = await fetch(`${BACKEND_URL}/repayments/record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userAddress, txHash: repayTx.hash })
  });
  const recData = await recRes.json();
  console.log("Record result:", JSON.stringify({
    recorded: recData.recorded,
    alreadyRecorded: recData.alreadyRecorded,
    amountUSD: recData.repayment && recData.repayment.amountUSD,
    tier: recData.evaluation && recData.evaluation.tier,
    records: recData.evaluation && recData.evaluation.repaymentRecords,
    totalPaidUSD: recData.evaluation && recData.evaluation.totalPaidUSD
  }));

  // 6. Re-issue credential — must reflect the upgraded tier
  const cred2Res = await fetch(`${BACKEND_URL}/credentials/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userAddress })
  });
  const cred2 = await cred2Res.json();
  console.log("New credential tier:", cred2.credential.tier, "| new tierHash differs:", cred2.tierHash !== cred.tierHash);
}

main().catch((e) => { console.error("FLOW ERROR:", e.message || e); process.exitCode = 1; });

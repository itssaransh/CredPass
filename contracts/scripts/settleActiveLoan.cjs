// One-off settlement: repay signer[1]'s active Tier A loan left by the
// e2e insufficient-liquidity borrow (which succeeded because pool liquidity
// exceeded the tier limit). Uses the deterministic EIP-712 tierHash.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "deploy-local.json"), "utf8"));

async function main() {
  const borrower = (await hre.ethers.getSigners())[1];
  const pool = new hre.ethers.Contract(
    config.contractAddress,
    (await hre.artifacts.readArtifact("CredPassLendingPool")).abi,
    borrower
  );

  const loan = await pool.getLoan(borrower.address);
  const tier = loan.tierVal;
  if (loan.repaidVal || loan.borrowerAddr === "0x0000000000000000000000000000000000000000") {
    console.log("No active loan to settle.");
    return;
  }
  const domain = { name: "CredPass", version: "1" };
  const types = { Credential: [{ name: "tier", type: "string" }, { name: "userAddress", type: "address" }] };
  const tierHash = hre.ethers.TypedDataEncoder.hash(domain, types, { tier, userAddress: borrower.address });
  const tx = await pool.repay(tierHash, { value: loan.repaymentDueVal });
  const receipt = await tx.wait();
  console.log("Settled loan for", borrower.address, "tier:", tier, "due:", hre.ethers.formatEther(loan.repaymentDueVal), "ETH, tx:", receipt.hash);
}

main().catch((e) => { console.error("SETTLE ERROR:", e.shortMessage || e.message || e); process.exitCode = 1; });

const hre = require("hardhat");

// Fund a MetaMask address on the local Hardhat node from a prefunded signer.
// Usage: npx hardhat run scripts/fund-address.cjs --network localhost
const TARGET = process.env.FUND_TARGET || "0xd67e7e18867abdf4e07ac89041fdba64a0f0d528";
const AMOUNT = process.env.FUND_AMOUNT || "1"; // ETH

async function main() {
  if (!/^0x[0-9a-fA-F]{40}$/.test(TARGET)) {
    throw new Error("FUND_TARGET must be a 0x-prefixed 40-hex address");
  }
  const [funder] = await hre.ethers.getSigners();
  console.log("Funder:", funder.address);
  console.log("Target:", TARGET);
  console.log("Amount:", AMOUNT, "ETH");
  const before = await hre.ethers.provider.getBalance(TARGET);
  const tx = await funder.sendTransaction({ to: TARGET, value: hre.ethers.parseEther(AMOUNT) });
  await tx.wait();
  const after = await hre.ethers.provider.getBalance(TARGET);
  console.log("Balance before:", hre.ethers.formatEther(before), "ETH");
  console.log("Balance after:", hre.ethers.formatEther(after), "ETH");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });

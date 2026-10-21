const hre = require("hardhat");

async function main() {
  const Pool = await hre.ethers.getContractFactory("CredPassLendingPool");
  const addresses = [
    "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    "0x0165878A594ca255338adfa4d48449f69242Eb8F"
  ];
  for (const addr of addresses) {
    try {
      const pool = await Pool.attach(addr);
      const evaluator = await pool.evaluator();
      const liquidity = await pool.getLiquidity();
      console.log("Address:", addr);
      console.log("  Evaluator:", evaluator);
      console.log("  Liquidity:", liquidity.toString());
    } catch (e) {
      console.log("Address:", addr, "- Error:", e.message);
    }
  }
}
main();

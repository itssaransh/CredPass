import { ethers } from "hardhat";

async function main() {
  // Deploy with the backend evaluator address to match signed credentials
  const evaluatorAddress = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
  const Pool = await ethers.deployContract("CredPassLendingPool", [evaluatorAddress]);
  await Pool.waitForDeployment();
  console.log("LendingPool deployed to:", await Pool.getAddress());
  console.log("Evaluator:", await Pool.evaluator());
}
main();

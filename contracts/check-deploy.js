async function main() {
  const contract = await ethers.getContractAt("CredPassLendingPool", "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0");
  console.log("Evaluator:", await contract.evaluator());
  console.log("Liquidity:", (await contract.getLiquidity()).toString());
}
main();

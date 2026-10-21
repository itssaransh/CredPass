async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const Pool = await ethers.getContractFactory("CredPassLendingPool");
  // Check if there's an existing deployment at the reported address
  try {
    const existing = await Pool.attach("0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0");
    const evaluator = await existing.evaluator();
    console.log("Existing contract at 0x9fE467... evaluator:", evaluator);
  } catch (e) {
    console.log("No contract at 0x9fE467...:", e.message);
  }
  try {
    const existing2 = await Pool.attach("0xFCAd0B19bB29D4674531d6f115237E16AfCE377c");
    console.log("Found at evaluator address (probably wrong)");
  } catch (e) {}
}
main();

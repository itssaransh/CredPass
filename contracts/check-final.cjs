async function main() {
  const contract = await ethers.getContractAt("CredPassLendingPool", "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0");
  console.log("Evaluator:", await contract.evaluator());
  console.log("Liquidity:", (await contract.getLiquidity()).toString());
  const accounts = await ethers.getSigners();
  const borrower = accounts[1].address;
  const loan = await contract.getLoan(borrower);
  console.log("Borrower:", borrower);
  console.log("Loan borrower:", loan.borrowerAddr || loan[0]);
  console.log("Principal:", (loan.principal || loan[1]).toString());
  console.log("Repaid:", loan.repaidVal !== undefined ? loan.repaidVal : loan[4]);
}
main();

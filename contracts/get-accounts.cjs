async function main() {
  const accounts = await ethers.getSigners();
  console.log("Account 0:", accounts[0].address);
  console.log("Account 1:", accounts[1].address);
}
main();

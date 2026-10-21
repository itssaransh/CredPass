async function main() {
  const signers = await ethers.getSigners();
  for (let i = 0; i < signers.length; i++) {
    console.log(`Signer ${i}:`, signers[i].address);
  }
}
main();

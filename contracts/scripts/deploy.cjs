const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config", "deploy-local.json");

async function main() {
  const evaluatorAddress = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
  const Pool = await hre.ethers.getContractFactory("CredPassLendingPool");
  const pool = await Pool.deploy(evaluatorAddress);
  await pool.waitForDeployment();
  const address = await pool.getAddress();
  console.log("LendingPool deployed to:", address);
  console.log("Evaluator:", await pool.evaluator());

  // Persist the active deployment so e2e-local.cjs, backend, and frontend all
  // read the same source of truth (overridable via CREDPASS_* env vars).
  const configPathExists = fs.existsSync(CONFIG_PATH);
  const config = configPathExists
    ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
    : { evaluatorAddress, chainId: "0x7a69", rpcUrl: "http://127.0.0.1:8545" };
  config.contractAddress = address;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  console.log("Saved active address to config/deploy-local.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

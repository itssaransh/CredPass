require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: {
      // Instant mining: the tx is mined before MetaMask's confirmation UI
      // even polls, killing the spurious "Transaction failed" toasts that the
      // interval-mining 1s race caused on the local network (2026-10-22).
      mining: { auto: true, interval: 0 },
    },
    localhost: { url: "http://127.0.0.1:8545" },
  },
};

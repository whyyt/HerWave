require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.28",
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://sepolia.infura.io/v3/YOUR_INFURA_KEY",
      accounts: process.env.PRIVATE_KEY && 
                 process.env.PRIVATE_KEY !== 'your_private_key_here' &&
                 process.env.PRIVATE_KEY.trim().length > 0
        ? [process.env.PRIVATE_KEY.trim()] 
        : [],
      chainId: 11155111,
      timeout: 60000, // 60 seconds
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
};

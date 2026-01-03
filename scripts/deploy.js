const hre = require("hardhat");
require("dotenv").config();

async function main() {
  console.log("开始部署 TravelMutualAid 合约...");
  
  // 检查环境变量
  if (!process.env.SEPOLIA_RPC_URL || process.env.SEPOLIA_RPC_URL.includes('YOUR_INFURA_KEY')) {
    console.error("❌ 错误: SEPOLIA_RPC_URL 未正确配置");
    console.error("请在 .env 文件中设置有效的 SEPOLIA_RPC_URL");
    process.exit(1);
  }
  
  if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY === 'your_private_key_here') {
    console.error("❌ 错误: PRIVATE_KEY 未正确配置");
    console.error("请在 .env 文件中设置有效的 PRIVATE_KEY");
    process.exit(1);
  }

  // 获取部署者账户
  const [deployer] = await hre.ethers.getSigners();
  console.log("使用账户部署:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  const balanceInEth = hre.ethers.formatEther(balance);
  console.log("账户余额:", balanceInEth, "ETH");
  
  if (parseFloat(balanceInEth) < 0.01) {
    console.warn("⚠️  警告: 账户余额可能不足以支付 gas 费用");
    console.warn("请访问 https://sepoliafaucet.com/ 获取 Sepolia ETH");
  }

  // 获取合约工厂
  const TravelMutualAid = await hre.ethers.getContractFactory("TravelMutualAid");
  
  // 部署合约
  console.log("正在部署合约...");
  const travelMutualAid = await TravelMutualAid.deploy();
  
  // 等待部署完成
  await travelMutualAid.waitForDeployment();
  
  const contractAddress = await travelMutualAid.getAddress();
  
  console.log("\n✅ 合约部署成功！");
  console.log("合约地址:", contractAddress);
  console.log("\n请将以下地址复制到 frontend/app/page.tsx 中的 CONTRACT_ADDRESS 变量：");
  console.log(`CONTRACT_ADDRESS = "${contractAddress}";`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });



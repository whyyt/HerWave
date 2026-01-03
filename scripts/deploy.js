const hre = require("hardhat");

async function main() {
  console.log("开始部署 TravelMutualAid 合约...");

  // 获取部署者账户
  const [deployer] = await hre.ethers.getSigners();
  console.log("使用账户部署:", deployer.address);
  console.log("账户余额:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

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



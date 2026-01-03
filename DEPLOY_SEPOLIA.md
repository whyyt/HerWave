# 部署到 Sepolia 测试网指南

## 前置准备

1. **获取 Sepolia ETH**
   - 访问 [Sepolia Faucet](https://sepoliafaucet.com/) 或 [Alchemy Faucet](https://sepoliafaucet.com/)
   - 将 Sepolia ETH 发送到你的部署账户

2. **获取 RPC URL**
   - 注册 [Infura](https://infura.io) 或 [Alchemy](https://alchemy.com) 账号
   - 创建新项目，选择 Sepolia 网络
   - 复制 RPC URL

3. **获取 Etherscan API Key**（可选，用于验证合约）
   - 访问 [Etherscan](https://etherscan.io/)
   - 注册账号并创建 API Key

## 配置步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在项目根目录创建 `.env` 文件：

```env
# Sepolia 测试网配置
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
# 或者使用 Alchemy
# SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY

# 部署合约的私钥（不要提交到 Git！）
PRIVATE_KEY=your_private_key_here

# Etherscan API Key（用于验证合约）
ETHERSCAN_API_KEY=your_etherscan_api_key_here
```

**⚠️ 重要：**
- 不要将 `.env` 文件提交到 Git
- 确保 `.env` 已添加到 `.gitignore`

### 3. 更新前端 RPC URL

编辑 `frontend/app/page.tsx`，找到 `SEPOLIA_CHAIN_CONFIG`，更新 RPC URL：

```typescript
const SEPOLIA_CHAIN_CONFIG = {
  chainId: '0xAA36A7', // 11155111 的十六进制
  chainName: 'Sepolia',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['https://sepolia.infura.io/v3/YOUR_INFURA_KEY'], // 替换为你的 RPC URL
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};
```

## 部署合约

### 1. 编译合约

```bash
npx hardhat compile
```

### 2. 部署到 Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

部署成功后，会输出合约地址，例如：
```
✅ 合约部署成功！
合约地址: 0x1234567890123456789012345678901234567890
```

### 3. 更新前端合约地址

编辑 `frontend/app/page.tsx`，更新 `CONTRACT_ADDRESS`：

```typescript
const CONTRACT_ADDRESS = "0x1234567890123456789012345678901234567890"; // 替换为实际部署的地址
```

### 4. （可选）验证合约

```bash
npx hardhat verify --network sepolia CONTRACT_ADDRESS
```

## 测试

1. 启动前端开发服务器：
```bash
cd frontend
npm run dev
```

2. 在浏览器中打开应用
3. 连接 MetaMask 钱包
4. 确保 MetaMask 已切换到 Sepolia 测试网
5. 测试应用功能

## 常见问题

### 1. 部署失败：insufficient funds
- 确保部署账户有足够的 Sepolia ETH
- 访问 Sepolia Faucet 获取测试币

### 2. 网络切换失败
- 检查 RPC URL 是否正确
- 确保 MetaMask 支持 Sepolia 网络

### 3. 合约调用失败
- 确认合约地址正确
- 确认 MetaMask 已切换到 Sepolia 网络
- 检查浏览器控制台的错误信息

## 网络信息

- **网络名称**: Sepolia
- **Chain ID**: 11155111 (0xAA36A7)
- **RPC URL**: 使用 Infura 或 Alchemy 提供的 URL
- **区块浏览器**: https://sepolia.etherscan.io
- **测试币水龙头**: https://sepoliafaucet.com/


# Hardhat Tron 开发指南

## 概述

本指南总结了使用 Hardhat 开发 Tron 智能合约的完整经验，包括编译、部署、代理模式和升级流程。

---

## 1. 环境配置

### 1.1 必要依赖

```bash
npm install --save-dev @layerzerolabs/hardhat-tron @layerzerolabs/hardhat-deploy
npm install tronweb
```

### 1.2 hardhat.config.js 配置

```javascript
require("@layerzerolabs/hardhat-deploy");
require("@layerzerolabs/hardhat-tron");

module.exports = {
  // Tron 编译器配置
  tronSolc: {
    enable: true,
    filter: [],
    compilers: [{ version: "0.8.24" }],  // tron-solc 最高支持 0.8.24
    versionRemapping: [
      ["0.8.28", "0.8.24"],
      ["0.8.27", "0.8.24"],
      ["0.8.26", "0.8.24"],
      ["0.8.25", "0.8.24"],
    ],
  },

  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 100 },
      viaIR: true,
    }
  },

  networks: {
    // 本地 TRE 节点
    tronLocal: {
      url: "http://127.0.0.1:9090/jsonrpc",
      accounts: [
        process.env.TRE_PRIVATE_KEY_1,
        process.env.TRE_PRIVATE_KEY_2
      ],
      tpiUrl: "http://127.0.0.1:9090",
      tron: true  // 关键：标记为 Tron 网络
    },
    // Nile 测试网
    tronNile: {
      url: "https://nile.trongrid.io/jsonrpc",
      accounts: [process.env.TRON_PRIVATE_KEY],
      tpiUrl: "https://nile.trongrid.io",
      tron: true
    },
    // 主网
    tronMainnet: {
      url: "https://api.trongrid.io/jsonrpc",
      accounts: [process.env.TRON_PRIVATE_KEY],
      tpiUrl: "https://api.trongrid.io",
      tron: true
    }
  },

  namedAccounts: {
    deployer: { default: 0 },
  }
};
```

---

## 2. 本地开发环境

### 2.1 启动 TRE (Tron Runtime Environment)

```bash
# 创建并启动 TRE 容器
docker run -d --name tron -p 9090:9090 tronbox/tre

# 查看日志
docker logs -f tron

# 获取测试账户
curl http://127.0.0.1:9090/admin/accounts
```

### 2.2 TRE 测试账户

每次重建容器会生成新的测试账户，需要重新获取私钥：

```bash
curl http://127.0.0.1:9090/admin/accounts
```

---

## 3. 编译

### 3.1 关键点

- **必须指定 `--network`**: 编译 Tron 合约时必须指定 Tron 网络
- **产物目录**: Tron 编译产物在 `artifacts-tron/` 目录
- **版本限制**: tron-solc 最高支持 0.8.24

```bash
# 编译 Tron 合约
npx hardhat compile --network tronLocal

# 产物位置
artifacts-tron/contracts/YourContract.sol/YourContract.json
```

### 3.2 OpenZeppelin 兼容性

| OpenZeppelin 版本 | tron-solc 版本 | 兼容性 |
|------------------|---------------|--------|
| 5.x | 0.8.24 | ✅ 完全兼容 |
| 5.x | 0.8.20 | ❌ 不兼容 (需要 0.8.21+) |
| 4.x | 0.8.20 | ✅ 兼容 |

---

## 4. 部署

### 4.1 核心原理

**Hardhat/Ethers.js 无法直接与 Tron API 交互**，部署必须使用 TronWeb。

```
Hardhat compile → artifacts-tron/ → TronWeb deploy → Tron Network
```

### 4.2 部署脚本示例

```javascript
const fs = require("fs");
const { TronWeb } = require("tronweb");

async function deploy() {
  // 1. 读取 Tron 编译产物
  const artifact = JSON.parse(
    fs.readFileSync("./artifacts-tron/contracts/MyContract.sol/MyContract.json")
  );

  // 2. 初始化 TronWeb (注意：私钥不带 0x 前缀)
  let privateKey = process.env.TRON_PRIVATE_KEY;
  if (privateKey.startsWith("0x")) {
    privateKey = privateKey.slice(2);  // 移除 0x 前缀
  }

  const tronWeb = new TronWeb({
    fullHost: "https://nile.trongrid.io",
    privateKey: privateKey
  });

  // 3. 部署合约
  const contract = await tronWeb.contract().new({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    feeLimit: 1000000000,  // 1000 TRX
    callValue: 0,          // 发送的 TRX (sun)
    parameters: [/* 构造函数参数 */]
  });

  // 4. 地址转换
  const hexAddress = contract.address;
  const base58Address = TronWeb.address.fromHex(hexAddress);

  console.log("Hex:", hexAddress);
  console.log("Tron:", base58Address);
}
```

### 4.3 地址格式

Tron 使用两种地址格式：

| 格式 | 示例 | 用途 |
|------|------|------|
| Hex | `41a24e79db7fcccc0917045972a159091a7d8d659f` | 合约内部、ABI 编码 |
| Base58 | `TQD174ms4N23tWLPTLuedHWVHkPb6nTino` | 用户界面、区块浏览器 |

```javascript
// 转换方法
TronWeb.address.fromHex(hexAddress)  // Hex → Base58
TronWeb.address.toHex(base58Address) // Base58 → Hex
```

---

## 5. 合约交互

### 5.1 读取方法 (view/pure)

```javascript
const contract = await tronWeb.contract(abi, contractAddress);

// 调用 view 方法
const value = await contract.myViewFunction().call();
```

### 5.2 写入方法 (transaction)

```javascript
// 发送交易
const txHash = await contract.myWriteFunction(arg1, arg2).send({
  feeLimit: 100000000,  // 100 TRX
  callValue: 0          // 发送的 TRX (sun)
});

// 等待确认 (Tron 通常很快)
await sleep(3000);
```

### 5.3 事件监听

```javascript
// 监听事件
contract.MyEvent().watch((err, event) => {
  if (err) return console.error(err);
  console.log(event);
});
```

---

## 6. 代理模式支持

### 6.1 测试结果

| 代理模式 | 部署 | 交互 | 升级 | 状态 |
|---------|------|------|------|------|
| Transparent Proxy | ✅ | ✅ | ✅ | 完全支持 |
| UUPS Proxy | ✅ | ✅ | ✅ | 完全支持 |
| Beacon Proxy | ✅ | ✅ | ✅ | 完全支持 |

### 6.2 代理部署示例

```javascript
// 1. 部署实现合约
const impl = await tronWeb.contract().new({
  abi: implArtifact.abi,
  bytecode: implArtifact.bytecode,
  feeLimit: 1000000000
});

// 2. 编码初始化数据
const functionSelector = tronWeb.sha3("initialize(address)").substring(0, 10);
const encodedParams = tronWeb.utils.abi.encodeParams(["address"], [ownerAddress]);
const initData = functionSelector + encodedParams.substring(2);

// 3. 部署代理
const proxy = await tronWeb.contract().new({
  abi: proxyArtifact.abi,
  bytecode: proxyArtifact.bytecode,
  feeLimit: 1000000000,
  parameters: [impl.address, adminAddress, initData]
});

// 4. 通过代理交互
const box = await tronWeb.contract(implArtifact.abi, proxy.address);
await box.store(42).send({ feeLimit: 100000000 });
```

### 6.3 升级流程

```javascript
// 1. 部署新实现
const implV2 = await tronWeb.contract().new({
  abi: implV2Artifact.abi,
  bytecode: implV2Artifact.bytecode,
  feeLimit: 1000000000
});

// 2. 执行升级 (Transparent Proxy)
const proxyAdmin = await tronWeb.contract(proxyArtifact.abi, proxyAddress);
await proxyAdmin.upgradeTo(implV2.address).send({ feeLimit: 100000000 });

// 3. 验证升级
const box = await tronWeb.contract(implV2Artifact.abi, proxyAddress);
const version = await box.version().call();  // 应该返回 "V2"
```

---

## 7. 通用部署脚本

支持 EVM 和 TVM 网络的统一部署脚本：

```javascript
// 自动检测网络类型
const networkConfig = hre.config.networks[hre.network.name];
const isTron = networkConfig && networkConfig.tron === true;

if (isTron) {
  // 使用 TronWeb 部署
  const artifact = loadTronArtifact(contractName);
  const tronWeb = createTronWeb(networkConfig);
  const contract = await tronWeb.contract().new({...});
} else {
  // 使用 Ethers.js 部署
  const Contract = await hre.ethers.getContractFactory(contractName);
  const contract = await Contract.deploy(...);
}
```

---

## 8. 常见问题

### 8.1 私钥格式

```javascript
// ❌ 错误：Hardhat 会自动加 0x 前缀
const pk = networkConfig.accounts[0];  // "0xa2d23d..."

// ✅ 正确：TronWeb 需要不带前缀的私钥
let pk = networkConfig.accounts[0];
if (pk.startsWith("0x")) {
  pk = pk.slice(2);
}
```

### 8.2 交互失败 "No contract"

部署后需要等待确认：

```javascript
await tronWeb.contract().new({...});
await sleep(3000);  // 等待 3 秒
const contract = await tronWeb.contract(abi, address);  // 再创建实例
```

### 8.3 编译错误

确保使用正确的 tron-solc 版本和映射：

```javascript
tronSolc: {
  compilers: [{ version: "0.8.24" }],  // 使用最新支持版本
  versionRemapping: [
    ["0.8.28", "0.8.24"],  // 映射高版本
  ],
}
```

---

## 9. 资源

### 9.1 测试网水龙头

- **Nile**: https://nileex.io/join/getJoinPage

### 9.2 区块浏览器

- **Nile**: https://nile.tronscan.org
- **Mainnet**: https://tronscan.org

### 9.3 TRE Docker

```bash
docker run -d --name tron -p 9090:9090 tronbox/tre
```

---

## 10. 总结

| 功能 | 支持情况 |
|------|----------|
| Hardhat 编译 | ✅ 通过 hardhat-tron |
| Hardhat 部署 | ⚠️ 需要 TronWeb |
| OpenZeppelin 5.x | ✅ tron-solc 0.8.24 |
| Transparent Proxy | ✅ 完全支持 |
| UUPS Proxy | ✅ 完全支持 |
| Beacon Proxy | ✅ 完全支持 |
| 合约升级 | ✅ 状态保持 |

**核心要点**：
1. 编译用 `npx hardhat compile --network tronXxx`
2. 部署用 TronWeb，不能直接用 Ethers.js
3. 私钥不带 `0x` 前缀
4. tron-solc 最高 0.8.24，支持 OpenZeppelin 5.x
5. 三种代理模式全部支持

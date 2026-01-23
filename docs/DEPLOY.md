# PayTheFlyPro Deployment Guide

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Deployment Steps](#deployment-steps)
- [Upgrade Procedures](#upgrade-procedures)
- [Network Configuration](#network-configuration)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         UUPS Proxy                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              PayTheFlyProFactory (Proxy)                  │  │
│  │  - createProject()                                        │  │
│  │  - setFeeVault() / setFeeRate()                          │  │
│  │  - upgradeBeacon() / upgradeToAndCall()                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  UpgradeableBeacon                        │  │
│  │              (manages implementation)                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │  BeaconProxy    │ │  BeaconProxy    │ │  BeaconProxy    │   │
│  │  (Project A)    │ │  (Project B)    │ │  (Project C)    │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Contract Roles

| Contract | Pattern | Purpose |
|----------|---------|---------|
| PayTheFlyProFactory | UUPS Proxy | Factory management, fee configuration |
| UpgradeableBeacon | Beacon | Manages project implementation address |
| PayTheFlyPro | BeaconProxy | Individual project contracts |

---

## Prerequisites

### 1. Environment Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### 2. Environment Variables

```env
# .env file
PRIVATE_KEY=your_deployer_private_key
ETHERSCAN_API_KEY=your_etherscan_api_key

# Network RPC URLs
MAINNET_RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
BSC_RPC_URL=https://bsc-dataseed.binance.org/
BSC_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545/

# TRON (optional)
TRON_PRIVATE_KEY=your_tron_private_key
TRON_NETWORK=mainnet|shasta|nile
```

### 3. Required Accounts

| Role | Description | Required For |
|------|-------------|--------------|
| Deployer | Deploys all contracts | Initial deployment |
| Owner | Factory owner (Ownable2Step) | Admin operations |
| FeeVault | Receives platform fees | Fee collection |

---

## Deployment Steps

### Step 1: Deploy PayTheFlyPro Implementation

```bash
# This is done automatically by the factory deployment script
```

### Step 2: Deploy Factory (EVM Networks)

```bash
# Mainnet
npx hardhat run scripts/deploy/deployFactory.js --network mainnet

# Sepolia Testnet
npx hardhat run scripts/deploy/deployFactory.js --network sepolia

# BSC
npx hardhat run scripts/deploy/deployFactory.js --network bsc
```

### Step 3: Deploy Factory (TRON)

```bash
# Set environment variables
export TRON_PRIVATE_KEY=your_private_key
export TRON_NETWORK=shasta  # or mainnet, nile
export FEE_VAULT=TYourFeeVaultAddress

# Deploy
node scripts/deploy/tron/deployFactory.js
```

### Step 4: Create Project

```bash
# EVM
npx hardhat run scripts/deploy/createProject.js --network sepolia

# TRON
node scripts/deploy/tron/createProject.js
```

### Deployment Script Parameters

Edit `scripts/deploy/deployFactory.js`:

```javascript
const FEE_RATE = 20;           // 0.2% (20 basis points)
const FEE_VAULT = "0x...";     // Fee recipient address
```

### Expected Output

```
========================================
PayTheFlyPro Deployment
========================================
Network: sepolia (chainId: 11155111)
Deployer: 0x...

Step 1: Deploying PayTheFlyPro implementation...
  Implementation: 0x...

Step 2: Deploying PayTheFlyProFactory (UUPS Proxy)...
  Factory Proxy: 0x...
  Factory Implementation: 0x...
  Beacon: 0x...

Deployment complete!
========================================
```

---

## Upgrade Procedures

### Upgrading Project Implementation (Beacon Upgrade)

This upgrades ALL existing projects simultaneously.

```bash
npx hardhat run scripts/deploy/upgradeBeacon.js --network sepolia
```

**Script: `scripts/deploy/upgradeBeacon.js`**

```javascript
const { ethers } = require("hardhat");

async function main() {
    const FACTORY_ADDRESS = "0x...";  // Your factory proxy address

    // Deploy new implementation
    const PayTheFlyProV2 = await ethers.getContractFactory("PayTheFlyProV2");
    const newImpl = await PayTheFlyProV2.deploy();
    await newImpl.waitForDeployment();

    // Upgrade beacon
    const factory = await ethers.getContractAt("PayTheFlyProFactory", FACTORY_ADDRESS);
    await factory.upgradeBeacon(await newImpl.getAddress());

    console.log("Beacon upgraded to:", await newImpl.getAddress());
}
```

**Important Notes:**
- All existing projects automatically use the new implementation
- Ensure storage layout compatibility (append-only)
- Test thoroughly on testnet first

### Upgrading Factory (UUPS Upgrade)

```bash
npx hardhat run scripts/deploy/upgradeFactory.js --network sepolia
```

**Script: `scripts/deploy/upgradeFactory.js`**

```javascript
const { ethers, upgrades } = require("hardhat");

async function main() {
    const FACTORY_PROXY_ADDRESS = "0x...";

    const PayTheFlyProFactoryV2 = await ethers.getContractFactory("PayTheFlyProFactoryV2");

    const upgraded = await upgrades.upgradeProxy(
        FACTORY_PROXY_ADDRESS,
        PayTheFlyProFactoryV2
    );

    console.log("Factory upgraded at:", await upgraded.getAddress());
}
```

### Upgrade Checklist

- [ ] Write new implementation contract
- [ ] Ensure storage layout compatibility
- [ ] Deploy and test on testnet
- [ ] Verify contract on block explorer
- [ ] Execute upgrade on mainnet
- [ ] Verify functionality post-upgrade

---

## Network Configuration

### hardhat.config.js

```javascript
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 100 },
      viaIR: true
    }
  },
  networks: {
    mainnet: {
      url: process.env.MAINNET_RPC_URL,
      accounts: [process.env.PRIVATE_KEY]
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [process.env.PRIVATE_KEY]
    },
    bsc: {
      url: process.env.BSC_RPC_URL,
      accounts: [process.env.PRIVATE_KEY]
    }
  }
};
```

### Supported Networks

| Network | Chain ID | Explorer |
|---------|----------|----------|
| Ethereum Mainnet | 1 | etherscan.io |
| Sepolia | 11155111 | sepolia.etherscan.io |
| BSC | 56 | bscscan.com |
| BSC Testnet | 97 | testnet.bscscan.com |
| TRON Mainnet | - | tronscan.org |
| TRON Shasta | - | shasta.tronscan.org |

---

## Verification

### Verify on Etherscan

```bash
# Verify implementation
npx hardhat verify --network sepolia IMPLEMENTATION_ADDRESS

# Verify proxy (use implementation ABI)
npx hardhat verify --network sepolia PROXY_ADDRESS
```

### Manual Verification

1. Go to block explorer
2. Navigate to contract address
3. Click "Verify and Publish"
4. Select "Solidity (Standard-Json-Input)"
5. Upload `artifacts/build-info/*.json`

---

## Local Testing

### EVM Testing (Hardhat)

```bash
# Run test deployment with built-in Hardhat network
npx hardhat run scripts/deploy/testDeploy.js

# Or with external Hardhat node
npx hardhat node &
npx hardhat run scripts/deploy/testDeploy.js --network localhost
```

**Expected Output:**
```
========================================
PayTheFlyPro Test Deployment
========================================
Network: hardhat (chainId: 31337)
Deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
========================================

Step 1: Deploying PayTheFlyPro implementation...
  Implementation: 0x5FbDB2315678afecb367f032d93F642f64180aa3

Step 2: Deploying PayTheFlyProFactory (UUPS Proxy)...
  Factory Proxy: 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
  Beacon: 0x75537828f2ce51be7289709686A69CbFDbB714F1

Step 3: Creating test project...
  Project Address: 0xE451980132E65465d0a498c53f0b5227326Dd73F

Step 5: Testing payment...
  Payment received: 0.998 ETH
  Fee collected: 0.002 ETH

All tests passed!
========================================
```

### TVM Testing (TRON TRE)

```bash
# Start TRE (TRON Runtime Environment)
docker run -d --name tron -p 9090:9090 -p 8545:8545 tronbox/tre

# Option 1: Deploy using Hardhat vars (recommended)
# First set the private key:
npx hardhat vars set TRE_LOCAL_TRON_DEVELOPMENT_KEY_1

# Then deploy:
TRON_NETWORK=local npx hardhat run scripts/deploy/tron/deployFactoryHardhat.js

# Option 2: Deploy using environment variables
TRON_PRIVATE_KEY=your_private_key \
TRON_NETWORK=local \
FEE_VAULT=your_fee_vault_address \
node scripts/deploy/tron/deployFactory.js
```

**Expected Output:**
```
========================================
PayTheFlyPro Factory Deployment (TRON)
========================================
Network: Local TRE
Deployer: TQmQUk71h6RmKTRS8YV6AJsc77ovQAWNaP
Balance: 6504.58 TRX
========================================

Step 1: Deploying PayTheFlyPro implementation...
  PayTheFlyPro Implementation: TWxSaNyD9zqDiEZmq8MfBVXY2Fs9aBFRev

Step 2: Deploying PayTheFlyProFactory...
  Factory Address: TYJvH616Aqn4zmCRUpVubaN6RqpXpFoVEu

Step 3: Initializing factory...
  Initialize TX: d6983f8592d3b9...

========================================
Deployment Summary (TRON)
========================================
PayTheFlyPro Implementation: TWxSaNyD9zqDiEZmq8MfBVXY2Fs9aBFRev
PayTheFlyProFactory: TYJvH616Aqn4zmCRUpVubaN6RqpXpFoVEu
========================================
```

---

## Deployed Addresses

### Mainnet

| Contract | Address |
|----------|---------|
| PayTheFlyPro Implementation | TBD |
| PayTheFlyProFactory Proxy | TBD |
| UpgradeableBeacon | TBD |

### Sepolia Testnet

| Contract | Address |
|----------|---------|
| PayTheFlyPro Implementation | TBD |
| PayTheFlyProFactory Proxy | TBD |
| UpgradeableBeacon | TBD |

---

## Troubleshooting

### Common Issues

**1. "Ownable: caller is not the owner"**
- Ensure you're using the owner account for admin functions

**2. "InvalidImplementation"**
- New implementation address must be a deployed contract
- Check if the contract was deployed successfully

**3. "FeeRateTooHigh"**
- Fee rate must be <= 1000 (10%)

**4. TRON deployment fails**
- Ensure TronWeb is installed: `npm install tronweb`
- Check TRON_PRIVATE_KEY format (hex without 0x prefix)
- feeLimit cannot exceed 1000000000 (1000 TRX)
- For local TRE: ensure Docker container is running on port 9090

**5. "Need at least 5 signers" error**
- Use default Hardhat network (without --network flag)
- Or configure multiple accounts in hardhat.config.js for localhost

### Gas Estimation

| Operation | Estimated Gas |
|-----------|---------------|
| Deploy Factory | ~1,500,000 |
| Create Project | ~500,000 |
| Pay (ETH) | ~130,000 |
| Pay (ERC20) | ~180,000 |
| Execute Proposal | ~75,000 - 150,000 |

---

## Security Considerations

1. **Private Key Management**
   - Never commit private keys to git
   - Use hardware wallets for mainnet deployments
   - Consider multi-sig for owner account

2. **Upgrade Safety**
   - Always test upgrades on testnet first
   - Verify storage layout compatibility
   - Use OpenZeppelin Upgrades plugin for validation

3. **Two-Step Ownership Transfer**
   - Factory uses Ownable2Step
   - New owner must call `acceptOwnership()`

---

## Quick Reference

### Deploy Commands

```bash
# EVM: Test deployment (Hardhat network)
npx hardhat run scripts/deploy/testDeploy.js

# EVM: Deploy to Sepolia
npx hardhat run scripts/deploy/deployFactory.js --network sepolia

# EVM: Create project
npx hardhat run scripts/deploy/createProject.js --network sepolia

# TRON: Deploy using Hardhat vars (recommended)
TRON_NETWORK=local npx hardhat run scripts/deploy/tron/deployFactoryHardhat.js
TRON_NETWORK=shasta npx hardhat run scripts/deploy/tron/deployFactoryHardhat.js

# TRON: Deploy using env variables
TRON_PRIVATE_KEY=xxx TRON_NETWORK=local FEE_VAULT=Txxx node scripts/deploy/tron/deployFactory.js
```

### Upgrade Commands

```bash
# Upgrade beacon (all projects)
npx hardhat run scripts/deploy/upgradeBeacon.js --network sepolia

# Upgrade factory
npx hardhat run scripts/deploy/upgradeFactory.js --network sepolia
```

### Verify Commands

```bash
npx hardhat verify --network sepolia CONTRACT_ADDRESS
```

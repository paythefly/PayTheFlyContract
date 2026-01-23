# PayTheFlyPro Deployment Guide

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [EVM Network Deployment](#evm-network-deployment)
4. [TRON Network Deployment](#tron-network-deployment)
5. [Post-Deployment Verification](#post-deployment-verification)
6. [Upgrade Procedures](#upgrade-procedures)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | >= 18.0.0 | Runtime environment |
| npm/yarn | Latest | Package management |
| Hardhat | >= 2.19.0 | EVM development framework |
| TronBox | >= 3.0.0 | TRON development (optional) |

### Installation

```bash
# Clone repository
git clone https://github.com/your-org/PayTheFlyPro.git
cd PayTheFlyPro

# Install dependencies
npm install

# Compile contracts
npx hardhat compile
```

### Required Accounts

1. **Deployer Account**: Must have sufficient native tokens for gas
2. **Fee Vault Address**: Address to receive platform fees
3. **Initial Admin**: First admin for created projects

---

## Environment Setup

### Environment Variables

Create a `.env` file in the project root:

```env
# EVM Networks
PRIVATE_KEY=your_deployer_private_key
ETHERSCAN_API_KEY=your_etherscan_api_key
BSCSCAN_API_KEY=your_bscscan_api_key

# TRON Networks
TRON_PRIVATE_KEY=your_tron_private_key

# Optional: Alchemy/Infura endpoints
ALCHEMY_API_KEY=your_alchemy_key
```

### Network Configuration

The `hardhat.config.js` includes pre-configured networks:

```javascript
// EVM Networks
networks: {
  mainnet: { chainId: 1, url: "..." },
  goerli: { chainId: 5, url: "..." },
  bsc: { chainId: 56, url: "https://bsc-dataseed.binance.org/" },
  bscTestnet: { chainId: 97, url: "https://data-seed-prebsc-1-s1.binance.org:8545/" },
  polygon: { chainId: 137, url: "https://polygon-rpc.com" },
  arbitrum: { chainId: 42161, url: "https://arb1.arbitrum.io/rpc" }
}

// TRON Networks (in scripts)
const TRON_NETWORKS = {
  mainnet: "https://api.trongrid.io",
  nile: "https://nile.trongrid.io",
  local: "http://127.0.0.1:9090"
}
```

---

## EVM Network Deployment

### Step 1: Deploy Factory Contract

```bash
# Deploy to specific network
FEE_VAULT=0xYourFeeVaultAddress npx hardhat run scripts/deploy/deployFactory.js --network bsc
```

**Deployment Script Output:**
```
Deploying PayTheFlyProFactory...
Implementation deployed to: 0x...
Beacon deployed to: 0x...
Factory Proxy deployed to: 0x...
Fee Vault: 0x...
Fee Rate: 100 (1%)
```

### Step 2: Verify Contracts (Optional)

```bash
# Verify on block explorer
npx hardhat verify --network bsc 0xFactoryAddress
```

### Step 3: Create First Project

```javascript
const factory = await ethers.getContractAt("PayTheFlyProFactory", FACTORY_ADDRESS);

const tx = await factory.createProject(
    "project-001",           // projectId
    "My First Project",      // name
    ADMIN_ADDRESS,           // admin
    SIGNER_ADDRESS           // signer
);

const receipt = await tx.wait();
const event = receipt.logs.find(log => log.fragment?.name === "ProjectCreated");
console.log("Project deployed to:", event.args.projectAddress);
```

### Deployment Addresses Record

Create a deployment record file:

```json
{
  "network": "bsc",
  "chainId": 56,
  "deployedAt": "2024-01-15T10:00:00Z",
  "contracts": {
    "factoryProxy": "0x...",
    "factoryImpl": "0x...",
    "beacon": "0x...",
    "projectImpl": "0x..."
  },
  "configuration": {
    "feeVault": "0x...",
    "feeRate": 100
  }
}
```

---

## TRON Network Deployment

### Network Selection

| Network | API Endpoint | Chain ID | Use Case |
|---------|--------------|----------|----------|
| Mainnet | api.trongrid.io | 728126428 | Production |
| Nile | nile.trongrid.io | 3448148188 | Testnet |
| Local | 127.0.0.1:9090 | Local | Development |

### Step 1: Compile for TRON

```bash
# Compile contracts with TRON-specific settings
npx hardhat compile
```

### Step 2: Deploy Factory

```bash
# Deploy to Nile testnet
TRON_PRIVATE_KEY=your_key \
TRON_NETWORK=nile \
FEE_VAULT=TVtiRNnzbrET6FndHBCLDxRBNid9LHMNjH \
node scripts/deploy/tron/deployFactory.js
```

**Output:**
```
Network: nile
Deploying PayTheFlyPro Implementation...
Implementation deployed: TXxx...
Deploying UpgradeableBeacon...
Beacon deployed: TYyy...
Deploying Factory Proxy...
Factory deployed: TZzz...
Deployment saved to: scripts/deploy/tron/deployment-nile.json
```

### Step 3: Create Project on TRON

```bash
TRON_PRIVATE_KEY=your_key \
TRON_NETWORK=nile \
FACTORY=TZzz... \
PROJECT_ID=my-project \
PROJECT_NAME="My Project" \
node scripts/deploy/tron/createProject.js
```

### Step 4: Test Signed Payment

```bash
# Deploy mock token for testing
TRON_PRIVATE_KEY=your_key \
TRON_NETWORK=nile \
TOKEN_NAME="Mock USDT" \
TOKEN_SYMBOL="MUSDT" \
TOKEN_DECIMALS=6 \
MINT_AMOUNT=1000000 \
node scripts/deploy/tron/deployMockToken.js

# Run payment tests
TRON_PRIVATE_KEY=your_key \
TRON_NETWORK=nile \
PROJECT=TProject... \
TOKEN=TToken... \
node scripts/deploy/tron/testSignedPayment.js
```

### TRON Deployment File Structure

```
scripts/deploy/tron/
├── deployFactory.js        # Factory deployment
├── createProject.js        # Project creation
├── deployMockToken.js      # Test token deployment
├── testSignedPayment.js    # Payment testing
├── testERC20.js           # ERC20 testing
├── deployment-mainnet.json # Mainnet addresses
├── deployment-nile.json    # Nile addresses
└── deployment-local.json   # Local addresses
```

---

## Post-Deployment Verification

### 1. Verify Factory Configuration

```javascript
// EVM
const factory = await ethers.getContractAt("PayTheFlyProFactory", FACTORY_ADDRESS);
console.log("Fee Vault:", await factory.feeVault());
console.log("Fee Rate:", await factory.feeRate());
console.log("Beacon:", await factory.beacon());
console.log("Owner:", await factory.owner());

// TRON
const factory = await tronWeb.contract().at(FACTORY_ADDRESS);
console.log("Fee Vault:", tronWeb.address.fromHex(await factory.feeVault().call()));
```

### 2. Test Project Creation

```javascript
// Create test project
const tx = await factory.createProject(
    "test-project",
    "Test Project",
    adminAddress,
    signerAddress
);

// Verify project exists
const projectAddress = await factory.getProject("test-project");
console.log("Project exists:", await factory.projectExists("test-project"));
```

### 3. Verify Project Initialization

```javascript
const project = await ethers.getContractAt("PayTheFlyPro", projectAddress);
const info = await project.getProjectInfo();

console.log("Project ID:", info.projectId);
console.log("Name:", info.name);
console.log("Creator:", info.creator);
console.log("Signer:", info.signer);
console.log("Admins:", info.admins);
console.log("Threshold:", info.threshold.toString());
```

### 4. Test Payment Flow

```javascript
// Generate payment signature
const domain = {
    name: "PayTheFlyPro",
    version: "1",
    chainId: chainId,
    verifyingContract: projectAddress
};

const types = {
    PaymentRequest: [
        { name: "projectId", type: "string" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "serialNo", type: "string" },
        { name: "deadline", type: "uint256" }
    ]
};

const value = {
    projectId: "test-project",
    token: ethers.ZeroAddress,
    amount: ethers.parseEther("0.01"),
    serialNo: "TEST-001",
    deadline: Math.floor(Date.now() / 1000) + 3600
};

const signature = await signer.signTypedData(domain, types, value);

// Execute payment
await project.pay(
    {
        token: ethers.ZeroAddress,
        amount: ethers.parseEther("0.01"),
        serialNo: "TEST-001",
        deadline: value.deadline
    },
    signature,
    { value: ethers.parseEther("0.01") }
);
```

---

## Upgrade Procedures

### Upgrade Factory (UUPS)

```javascript
// 1. Deploy new implementation
const NewFactory = await ethers.getContractFactory("PayTheFlyProFactoryV2");
const newImpl = await NewFactory.deploy();

// 2. Upgrade proxy (owner only)
const factory = await ethers.getContractAt("PayTheFlyProFactory", FACTORY_PROXY);
await factory.upgradeToAndCall(newImpl.address, "0x");

// 3. Verify upgrade
console.log("New implementation active");
```

### Upgrade All Projects (Beacon)

```javascript
// 1. Deploy new project implementation
const NewProject = await ethers.getContractFactory("PayTheFlyProV2");
const newProjectImpl = await NewProject.deploy();

// 2. Upgrade beacon (factory owner only)
const factory = await ethers.getContractAt("PayTheFlyProFactory", FACTORY_ADDRESS);
await factory.upgradeBeacon(newProjectImpl.address);

// 3. All existing projects now use new implementation
// No per-project migration needed!
```

### Storage Compatibility Checklist

Before upgrading, verify:

- [ ] New implementation maintains storage layout order
- [ ] No storage slots removed or reordered
- [ ] New variables added at end of storage
- [ ] Interface remains backwards compatible
- [ ] All existing tests pass with new implementation

---

## Troubleshooting

### Common Issues

#### 1. "Insufficient funds for gas"

```bash
# Check deployer balance
npx hardhat run scripts/checkBalance.js --network bsc

# Solution: Transfer native tokens to deployer
```

#### 2. "Project already exists"

```javascript
// Check if project ID is taken
const exists = await factory.projectExists("my-project");
// Solution: Use a unique project ID
```

#### 3. "Invalid signature" on payment

```javascript
// Verify signature parameters match exactly:
// 1. Domain chainId matches current network
// 2. verifyingContract matches project address
// 3. projectId in signature matches contract's projectId
// 4. deadline has not passed
// 5. Signer address matches project's authorized signer
```

#### 4. TRON: "Transaction expired"

```javascript
// Increase transaction expiration time
const tx = await contract.methodName(args).send({
    feeLimit: 1000000000,
    callValue: 0,
    shouldPollResponse: true
});
```

#### 5. TRON: "REVERT opcode executed"

```javascript
// Check contract call parameters
// Verify TRC20 approval for token transfers
// Ensure sufficient TRX for energy
```

### Getting Help

1. Check [GitHub Issues](https://github.com/your-org/PayTheFlyPro/issues)
2. Review test files for usage examples
3. Contact support with deployment transaction hash

---

## Deployment Checklist

### Pre-Deployment

- [ ] Environment variables configured
- [ ] Deployer account funded
- [ ] Fee vault address determined
- [ ] Initial admin/signer addresses ready
- [ ] Network RPC endpoints accessible

### Deployment

- [ ] Factory deployed successfully
- [ ] Implementation address recorded
- [ ] Beacon address recorded
- [ ] Factory proxy address recorded
- [ ] Fee configuration verified

### Post-Deployment

- [ ] Test project created
- [ ] Payment flow tested
- [ ] Withdrawal flow tested
- [ ] Multi-sig operations tested
- [ ] Deployment addresses documented
- [ ] Contracts verified on explorer (if applicable)

---

## Quick Reference

### EVM Deployment Commands

```bash
# BSC Mainnet
FEE_VAULT=0x... npx hardhat run scripts/deploy/deployFactory.js --network bsc

# Polygon
FEE_VAULT=0x... npx hardhat run scripts/deploy/deployFactory.js --network polygon

# Arbitrum
FEE_VAULT=0x... npx hardhat run scripts/deploy/deployFactory.js --network arbitrum
```

### TRON Deployment Commands

```bash
# Mainnet
TRON_NETWORK=mainnet FEE_VAULT=T... node scripts/deploy/tron/deployFactory.js

# Nile Testnet
TRON_NETWORK=nile FEE_VAULT=T... node scripts/deploy/tron/deployFactory.js
```

---

## Next Steps

- [Technical Architecture](./TECHNICAL_ARCHITECTURE.md)
- [API Reference](./API_REFERENCE.md)
- [User Guide](./USER_GUIDE.md)

# PayTheFlyPro Technical Architecture

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Contract Structure](#contract-structure)
4. [Storage Layout](#storage-layout)
5. [Upgrade Mechanism](#upgrade-mechanism)
6. [Security Model](#security-model)
7. [Gas Optimization](#gas-optimization)

---

## Overview

PayTheFlyPro is a decentralized payment management system built on EVM-compatible blockchains and TRON. It provides:

- **Project-based fund management** with isolated contracts per project
- **Multi-signature governance** for sensitive operations
- **EIP-712 signed payments** for secure, verifiable transactions
- **Dual fund pools** (Payment Pool + Withdrawal Pool) for flexible fund management
- **Universal ERC20 support** including non-standard tokens like TRON USDT

### Version Comparison

| Feature | V1 (PayTheFly) | V2 (PayTheFlyPro) |
|---------|----------------|-------------------|
| Architecture | Single contract | Factory + Beacon Proxy |
| Governance | Single owner | Multi-sig |
| Project isolation | Shared state | Isolated contracts |
| Upgrade pattern | UUPS | UUPS (Factory) + Beacon (Projects) |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PayTheFlyPro System                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────┐      ┌──────────────────────────────────┐ │
│  │  PayTheFlyProFactory │      │        UpgradeableBeacon         │ │
│  │    (UUPS Proxy)      │─────▶│   (manages implementation)       │ │
│  │                      │      └──────────────────────────────────┘ │
│  │  - createProject()   │                     │                     │
│  │  - setFeeVault()     │                     ▼                     │
│  │  - setFeeRate()      │      ┌──────────────────────────────────┐ │
│  │  - upgradeBeacon()   │      │   PayTheFlyPro Implementation    │ │
│  └──────────────────────┘      │   (shared by all projects)       │ │
│            │                   └──────────────────────────────────┘ │
│            │ creates                          ▲                     │
│            ▼                                  │ delegates to        │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                      BeaconProxy Instances                      ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             ││
│  │  │  Project A  │  │  Project B  │  │  Project C  │   ...       ││
│  │  │ (isolated)  │  │ (isolated)  │  │ (isolated)  │             ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘             ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **PayTheFlyProFactory** (UUPS Upgradeable)
   - Creates new project contracts
   - Manages global fee configuration
   - Controls beacon upgrades
   - Two-step ownership transfer

2. **UpgradeableBeacon**
   - Points to current PayTheFlyPro implementation
   - Enables atomic upgrades for all projects
   - Owned by Factory contract

3. **PayTheFlyPro** (BeaconProxy)
   - Individual project contract instance
   - Isolated state per project
   - Multi-sig governance
   - EIP-712 signature verification

---

## Contract Structure

### Inheritance Hierarchy

```
PayTheFlyProFactory
├── IPayTheFlyProFactory
├── UUPSUpgradeable
└── Ownable2StepUpgradeable

PayTheFlyPro
├── IPayTheFlyPro
├── Initializable
├── EIP712Upgradeable
└── ReentrancyGuardUpgradeable
```

### Library Dependencies

```
contracts/
├── PayTheFlyPro.sol
├── PayTheFlyProFactory.sol
├── interfaces/
│   ├── IPayTheFlyPro.sol
│   └── IPayTheFlyProFactory.sol
└── libraries/
    ├── DataTypes.sol      # Shared structs and constants
    ├── Errors.sol         # Custom error definitions
    ├── TypeHashes.sol     # EIP-712 type hashes
    └── SafeERC20Universal.sol  # Universal token transfer
```

---

## Storage Layout

### PayTheFlyProFactory Storage

| Slot | Variable | Type | Description |
|------|----------|------|-------------|
| 0 | _beacon | UpgradeableBeacon | Beacon contract reference |
| 1 | _feeVault | address | Fee collection address |
| 2 | _feeRate | uint256 | Fee rate in basis points |
| 3 | _projects | mapping(string => address) | Project ID to address |
| 4 | _projectExists | mapping(string => bool) | Project existence check |

### PayTheFlyPro Storage

| Slot | Variable | Type | Description |
|------|----------|------|-------------|
| 0 | _factory | address | Factory contract address |
| 1 | _projectId | string | Unique project identifier |
| 2 | _name | string | Project display name |
| 3 | _creator | address | Project creator address |
| 4 | _signer | address | Authorized signer for requests |
| 5 | _paused | bool | Project pause status |
| 6 | _admins | address[] | List of admin addresses |
| 7 | _isAdmin | mapping(address => bool) | Admin check mapping |
| 8 | _adminIndex | mapping(address => uint256) | Admin array index |
| 9 | _threshold | uint256 | Multi-sig threshold |
| 10 | _proposalCount | uint256 | Total proposals created |
| 11 | _pendingProposalCount | uint256 | Active pending proposals |
| 12 | _proposals | mapping(uint256 => Proposal) | Proposal storage |
| 13 | _confirmations | mapping(uint256 => mapping(address => bool)) | Confirmation tracking |
| 14 | _paymentBalances | mapping(address => uint256) | Payment pool balances |
| 15 | _withdrawalBalances | mapping(address => uint256) | Withdrawal pool balances |
| 16 | _usedPaymentSerialNos | mapping(string => bool) | Used payment serial numbers |
| 17 | _usedWithdrawalSerialNos | mapping(string => bool) | Used withdrawal serial numbers |

---

## Upgrade Mechanism

### Factory Upgrade (UUPS)

```solidity
// Only owner can upgrade
function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

// Upgrade process
1. Deploy new Factory implementation
2. Call upgradeTo(newImplementation) on proxy
3. Storage is preserved
```

### Project Upgrade (Beacon)

```solidity
// Upgrade all projects at once
function upgradeBeacon(address newImplementation) external onlyOwner {
    // Validate new implementation
    if (newImplementation.code.length == 0) revert InvalidImplementation();

    // Upgrade beacon (affects all projects immediately)
    _beacon.upgradeTo(newImplementation);
}
```

### Upgrade Safety

1. **Storage Compatibility**: New implementations must maintain storage layout
2. **Interface Compatibility**: New implementations should be backwards compatible
3. **Initialization**: Use `reinitializer(version)` for upgrade initialization

---

## Security Model

### Access Control Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    Factory Level                             │
│  Owner (Ownable2Step)                                       │
│  ├── upgradeBeacon()                                        │
│  ├── setFeeVault()                                          │
│  ├── setFeeRate()                                           │
│  └── transferOwnership() (two-step)                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Project Level                             │
│  Admin (Multi-Sig)                                          │
│  ├── Single Admin Operations                                │
│  │   ├── depositToWithdrawalPool()                          │
│  │   └── setName()                                          │
│  │                                                          │
│  └── Multi-Sig Operations (threshold required)              │
│      ├── SetSigner                                          │
│      ├── AddAdmin / RemoveAdmin                             │
│      ├── ChangeThreshold                                    │
│      ├── AdminWithdraw (from payment pool)                  │
│      ├── WithdrawFromPool (from withdrawal pool)            │
│      ├── Pause / Unpause                                    │
│      └── EmergencyWithdraw                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    User Level                                │
│  Signer Verification (EIP-712)                              │
│  ├── pay() - Anyone with valid signature                    │
│  └── withdraw() - User specified in request (msg.sender)    │
└─────────────────────────────────────────────────────────────┘
```

### Signature Security (EIP-712)

```solidity
// Payment Request Type
PaymentRequest(
    string projectId,
    address token,
    uint256 amount,
    string serialNo,
    uint256 deadline
)

// Withdrawal Request Type (includes user binding)
WithdrawalRequest(
    address user,        // Must match msg.sender
    string projectId,
    address token,
    uint256 amount,
    string serialNo,
    uint256 deadline
)
```

### Reentrancy Protection

All external-facing functions with fund transfers use `nonReentrant`:
- `pay()`
- `withdraw()`
- `executeProposal()`

---

## Gas Optimization

### O(1) Pending Proposal Counting

```solidity
// Instead of iterating all proposals
uint256 private _pendingProposalCount;

// Increment on create
_pendingProposalCount++;

// Decrement on execute/cancel
_pendingProposalCount--;
```

### Admin Array Management (Swap and Pop)

```solidity
// Remove admin efficiently
uint256 index = _adminIndex[admin];
uint256 lastIndex = _admins.length - 1;

if (index != lastIndex) {
    address lastAdmin = _admins[lastIndex];
    _admins[index] = lastAdmin;
    _adminIndex[lastAdmin] = index;
}

_admins.pop();
```

### Constants

```solidity
// DataTypes.sol
uint256 constant MAX_FEE_RATE = 1000;           // 10%
uint256 constant BASIS_POINTS = 10000;          // 100%
uint256 constant MAX_PROJECT_ID_LENGTH = 128;
uint256 constant MAX_NAME_LENGTH = 256;
uint256 constant MAX_SERIAL_NO_LENGTH = 128;
uint256 constant MAX_ADMINS = 20;
uint256 constant MIN_PROPOSAL_DURATION = 1 hours;
uint256 constant MAX_PROPOSAL_DURATION = 30 days;
```

---

## Event Schema

### User Transaction Events

```solidity
event PayTheFlyTransaction(
    string projectId,
    address indexed token,
    address indexed account,
    uint256 amount,
    uint256 fee,
    string serialNo,
    TxType indexed txType  // PAYMENT(1), WITHDRAWAL(2)
);
```

### Admin Operation Events

```solidity
event AdminPoolOperation(
    string projectId,
    address indexed token,
    address indexed recipient,
    uint256 amount,
    uint256 indexed proposalId,
    AdminPoolOpType opType  // ADMIN_WITHDRAWAL(1), POOL_DEPOSIT(2), POOL_WITHDRAW(3), EMERGENCY_WITHDRAW(4)
);
```

---

## Chain Support

| Chain | Network | Contract Type | Notes |
|-------|---------|---------------|-------|
| Ethereum | Mainnet/Goerli | EVM | Standard deployment |
| BSC | Mainnet/Testnet | EVM | Standard deployment |
| Polygon | Mainnet/Mumbai | EVM | Standard deployment |
| Arbitrum | One/Goerli | EVM | Standard deployment |
| TRON | Mainnet/Nile | TVM | Uses SafeERC20Universal |

---

## Next Steps

- [API Reference](./API_REFERENCE.md)
- [User Guide](./USER_GUIDE.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)

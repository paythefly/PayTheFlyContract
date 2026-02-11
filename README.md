# PayTheFlyPro

> Multi-chain payment and withdrawal infrastructure with multi-signature governance and EIP-712 signature verification.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.28-blue)](https://soliditylang.org/)
[![BNB Chain](https://img.shields.io/badge/BNB%20Chain-Mainnet-F0B90B)](https://www.bnbchain.org/)
[![Ethereum](https://img.shields.io/badge/Ethereum-Mainnet-627EEA)](https://ethereum.org/)
[![TRON](https://img.shields.io/badge/TRON-Mainnet-FF0013)](https://tron.network/)

## Overview

PayTheFlyPro is a decentralized payment infrastructure that enables secure, signature-based payments and withdrawals across multiple blockchain networks. The system utilizes the Beacon Proxy pattern for upgradeable project contracts, multi-signature governance for administrative operations, and EIP-712 signatures for user transactions.

## Key Features

### 🔐 Security First
- **EIP-712 Signature Verification**: All payment and withdrawal operations require cryptographic signatures
- **Multi-Signature Governance**: Administrative operations require multi-admin consensus
- **ReentrancyGuard**: Protection against reentrancy attacks
- **Pausable Operations**: Emergency pause capability for critical situations
- **Serial Number Tracking**: Prevents replay attacks and duplicate transactions

### ⚡ Upgradeable Architecture
- **Beacon Proxy Pattern**: Efficient upgrades for all project contracts simultaneously
- **UUPS Upgradeable Factory**: Secure upgrade mechanism with authorization controls
- **Version Management**: Complete upgrade history tracking

### 💰 Flexible Payment System
- **Native Token Support**: ETH (Ethereum), BNB (BSC), TRX (TRON)
- **ERC20 Token Support**: Any standard ERC20/TRC20 token
- **Dual Pool System**: Separate payment and withdrawal pools
- **Configurable Fees**: Factory-level fee rate configuration with withdrawal fee collection

### 🌐 Multi-Chain Support
- **BNB Chain (BSC)**: BNB Smart Chain Mainnet & Testnet
- **Ethereum**: Mainnet & Sepolia Testnet
- **TRON**: Mainnet & Nile Testnet

## Architecture

### System Overview

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

### Core Contracts

- **PayTheFlyProFactory**: Factory contract for creating and managing project contracts (UUPS upgradeable)
- **PayTheFlyPro**: Individual project contract with isolated state and multi-sig governance
- **UpgradeableBeacon**: Manages the implementation contract for all projects

## Deployed Contracts

### BNB Chain (BSC) Mainnet
- **Factory Proxy**: `0xB647E98e40855c9dF7fc76281837c3ed0c6B22Ef`
- **Factory Implementation**: `0x7Ca6F4e939b8194f61fBa8cDe8fC17C71Ee63bf0`
- **Beacon**: `0x0A6D45CdAdBaE845F5F85d6Ab7C9549eC8b3DB23`
- **Implementation**: `0xf9aC50f02a92e89f0Bd84f94e5B5BfA1F91c18cf`

### Ethereum Mainnet
- **Factory Proxy**: `0xB647E98e40855c9dF7fc76281837c3ed0c6B22Ef`
- **Factory Implementation**: `0x7Ca6F4e939b8194f61fBa8cDe8fC17C71Ee63bf0`
- **Beacon**: `0x0A6D45CdAdBaE845F5F85d6Ab7C9549eC8b3DB23`
- **Implementation**: `0xf9aC50f02a92e89f0Bd84f94e5B5BfA1F91c18cf`

### TRON Mainnet
- **Factory Proxy**: `TKafCgE7hcvQBx4YPNBzb3u36BDzRiMB4Q`
- **Factory Implementation**: `TQFjjxBrNHPMhtNn78BQtjW3iUTrZEohRm`
- **Beacon**: `TFoBdTGGKyJrBsPsPdYpmhKXzKf1RBGBjN`
- **Implementation**: `TRgmrTe43XVRqhxjvKsqfyV4i3EJrLqPB1`

## Documentation

Comprehensive documentation is available in the [`docs/`](./docs/) directory:

- [**Technical Architecture**](./docs/TECHNICAL_ARCHITECTURE.md) - System design and implementation details
- [**API Reference**](./docs/API_REFERENCE.md) - Complete contract interface documentation
- [**User Guide**](./docs/USER_GUIDE.md) - Step-by-step guide for using the system
- [**Deployment Guide**](./docs/DEPLOYMENT_GUIDE.md) - Instructions for deploying contracts
- [**Comparison with V1**](./docs/COMPARISON.md) - Feature comparison between versions

## Contract Structure

```
contracts/
├── PayTheFlyProFactory.sol       # Factory contract (UUPS)
├── PayTheFlyPro.sol              # Project contract (Beacon Proxy)
├── interfaces/
│   ├── IPayTheFlyProFactory.sol
│   └── IPayTheFlyPro.sol
└── libraries/
    ├── DataTypes.sol             # Struct definitions
    ├── Errors.sol                # Custom errors
    ├── SafeERC20Universal.sol    # Universal ERC20 handling
    └── TypeHashes.sol            # EIP-712 type hashes
```

## Key Operations

### For Project Owners

1. **Create Project**: Deploy a new isolated project contract
2. **Add/Remove Admins**: Manage multi-sig governance
3. **Deposit Funds**: Add funds to payment or withdrawal pool
4. **Withdraw Funds**: Require multi-admin approval
5. **Pause/Unpause**: Emergency controls

### For Users

1. **Make Payments**: Submit signed payment requests (EIP-712)
2. **Request Withdrawals**: Submit signed withdrawal requests
3. **Query Status**: Check transaction status and pool balances

## Security Features

- ✅ **Audited by**: [Your audit firm]
- ✅ **OpenZeppelin Contracts**: Battle-tested implementations
- ✅ **Multi-sig Governance**: Prevents single point of failure
- ✅ **Signature Verification**: EIP-712 standard compliance
- ✅ **Reentrancy Protection**: Guards on all external calls
- ✅ **Emergency Pause**: Admin-controlled circuit breaker

## Development

This repository contains only the contract source code and documentation for public showcase. For build instructions and development setup, please refer to the [Deployment Guide](./docs/DEPLOYMENT_GUIDE.md).

### Requirements

- Solidity ^0.8.28
- OpenZeppelin Contracts Upgradeable
- EIP-712 signature support

## License

This project is licensed under the [MIT License](LICENSE).

## Version History

- **V2.0** (PayTheFlyPro): Current version with factory pattern and multi-sig
- **V1.0** (PayTheFly): Original single-contract version

## Contact & Support

For questions, issues, or integration support, please refer to the documentation or contact the project maintainers.

---

**Note**: This is a showcase repository containing only contract code and documentation. Deployment scripts, tests, and configuration files are maintained separately for security purposes.

# PayTheFlyPro API Reference

## Table of Contents

1. [PayTheFlyProFactory](#paytheflyrofactory)
2. [PayTheFlyPro](#paytheflyro)
3. [Data Types](#data-types)
4. [Events](#events)
5. [Errors](#errors)

---

## PayTheFlyProFactory

Factory contract for creating and managing project contracts.

### View Functions

#### `beacon()`
```solidity
function beacon() external view returns (address)
```
Returns the UpgradeableBeacon contract address.

#### `feeVault()`
```solidity
function feeVault() external view returns (address)
```
Returns the address where fees are collected.

#### `feeRate()`
```solidity
function feeRate() external view returns (uint256)
```
Returns the fee rate in basis points (10000 = 100%).

#### `getProject()`
```solidity
function getProject(string calldata projectId) external view returns (address)
```
Get project contract address by project ID.

| Parameter | Type | Description |
|-----------|------|-------------|
| projectId | string | Unique project identifier |

**Returns**: Project contract address, or `address(0)` if not exists.

#### `projectExists()`
```solidity
function projectExists(string calldata projectId) external view returns (bool)
```
Check if a project exists.

#### `pendingOwner()`
```solidity
function pendingOwner() external view returns (address)
```
Returns the pending owner address for two-step ownership transfer.

### State-Changing Functions

#### `createProject()`
```solidity
function createProject(
    string calldata projectId,
    string calldata name,
    address admin,
    address signer
) external returns (address projectAddress)
```
Create a new project contract.

| Parameter | Type | Description |
|-----------|------|-------------|
| projectId | string | Unique identifier (max 128 chars) |
| name | string | Project name (max 256 chars) |
| admin | address | Initial admin address |
| signer | address | Initial signer for payment/withdrawal |

**Returns**: Deployed project contract address.

**Emits**: `ProjectCreated`

#### `setFeeVault()` (Owner only)
```solidity
function setFeeVault(address newFeeVault) external
```
Update the fee vault address.

**Emits**: `FeeVaultUpdated`

#### `setFeeRate()` (Owner only)
```solidity
function setFeeRate(uint256 newFeeRate) external
```
Update the fee rate (max 1000 = 10%).

**Emits**: `FeeRateUpdated`

#### `upgradeBeacon()` (Owner only)
```solidity
function upgradeBeacon(address newImplementation) external
```
Upgrade the beacon to a new implementation. Affects all existing projects immediately.

**Emits**: `BeaconUpgraded`

#### `transferOwnership()` (Owner only)
```solidity
function transferOwnership(address newOwner) external
```
Initiate two-step ownership transfer.

#### `acceptOwnership()` (Pending owner only)
```solidity
function acceptOwnership() external
```
Accept pending ownership transfer.

#### `cancelOwnershipTransfer()` (Owner only)
```solidity
function cancelOwnershipTransfer() external
```
Cancel pending ownership transfer.

**Emits**: `OwnershipTransferCancelled`

---

## PayTheFlyPro

Individual project contract for payment management.

### View Functions

#### `getProjectInfo()`
```solidity
function getProjectInfo() external view returns (ProjectInfo memory)
```
Get comprehensive project information.

**Returns**:
```solidity
struct ProjectInfo {
    string projectId;
    string name;
    address creator;
    address signer;
    bool paused;
    address[] admins;
    uint256 threshold;
    uint256 activeProposalCount;
}
```

#### `getBalance()`
```solidity
function getBalance(address token) external view returns (TokenBalance memory)
```
Get balance for a specific token.

| Parameter | Type | Description |
|-----------|------|-------------|
| token | address | Token address (`address(0)` for ETH/TRX) |

**Returns**:
```solidity
struct TokenBalance {
    uint256 paymentBalance;     // Payment pool balance
    uint256 withdrawalBalance;  // Withdrawal pool balance
}
```

#### `getBalancesBatch()`
```solidity
function getBalancesBatch(address[] calldata tokens) external view returns (TokenBalance[] memory)
```
Get balances for multiple tokens in one call.

#### `getAdmins()`
```solidity
function getAdmins() external view returns (address[] memory)
```
Get list of all admin addresses.

#### `getThreshold()`
```solidity
function getThreshold() external view returns (uint256)
```
Get current multi-sig threshold.

#### `isAdmin()`
```solidity
function isAdmin(address account) external view returns (bool)
```
Check if an address is an admin.

#### `getProposal()`
```solidity
function getProposal(uint256 proposalId) external view returns (ProposalInfo memory)
```
Get proposal details by ID.

**Returns**:
```solidity
struct ProposalInfo {
    uint256 id;
    OperationType opType;
    bytes params;
    address proposer;
    uint256 deadline;
    uint256 confirmCount;
    bool executed;
    bool cancelled;
    address[] confirmedBy;
}
```

#### `getProposalCount()`
```solidity
function getProposalCount() external view returns (uint256)
```
Get total number of proposals created.

#### `getProposalsPaginated()`
```solidity
function getProposalsPaginated(
    uint256 offset,
    uint256 limit
) external view returns (ProposalInfo[] memory proposals, uint256 total)
```
Get proposals with pagination (newest first).

#### `hasConfirmed()`
```solidity
function hasConfirmed(uint256 proposalId, address admin) external view returns (bool)
```
Check if an admin has confirmed a proposal.

#### `isPaymentSerialNoUsed()`
```solidity
function isPaymentSerialNoUsed(string calldata serialNo) external view returns (bool)
```
Check if a payment serial number has been used.

#### `isWithdrawalSerialNoUsed()`
```solidity
function isWithdrawalSerialNoUsed(string calldata serialNo) external view returns (bool)
```
Check if a withdrawal serial number has been used.

### Payment Functions

#### `pay()`
```solidity
function pay(
    PaymentRequest calldata request,
    bytes calldata signature
) external payable
```
Process a payment with EIP-712 signature verification.

**Request Structure**:
```solidity
struct PaymentRequest {
    address token;      // Token address (address(0) for ETH/TRX)
    uint256 amount;     // Payment amount
    string serialNo;    // Unique serial number
    uint256 deadline;   // Signature expiration timestamp
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| request | PaymentRequest | Payment details |
| signature | bytes | EIP-712 signature from project signer |

**Requirements**:
- Project must not be paused
- Serial number must be unique
- Deadline must not have passed
- Signature must be valid from project signer
- For ETH: `msg.value` must equal `amount`
- For ERC20: Token approval required

**Emits**: `PayTheFlyTransaction` with `TxType.PAYMENT`

#### `withdraw()`
```solidity
function withdraw(
    WithdrawalRequest calldata request,
    bytes calldata signature
) external
```
Process a withdrawal with EIP-712 signature verification.

**Request Structure**:
```solidity
struct WithdrawalRequest {
    address user;       // Must match msg.sender
    address token;      // Token address (address(0) for ETH/TRX)
    uint256 amount;     // Withdrawal amount
    string serialNo;    // Unique serial number
    uint256 deadline;   // Signature expiration timestamp
}
```

**Requirements**:
- Project must not be paused
- `request.user` must equal `msg.sender` (prevents MEV front-running)
- Serial number must be unique
- Deadline must not have passed
- Signature must be valid from project signer
- Sufficient balance in withdrawal pool

**Emits**: `PayTheFlyTransaction` with `TxType.WITHDRAWAL`

### Admin Functions (No Multi-Sig)

#### `setName()` (Admin only)
```solidity
function setName(string calldata newName) external
```
Update project display name.

**Emits**: `ProjectNameUpdated`

#### `depositToWithdrawalPool()` (Admin only)
```solidity
function depositToWithdrawalPool(address token, uint256 amount) external payable
```
Deposit funds to the withdrawal pool.

| Parameter | Type | Description |
|-----------|------|-------------|
| token | address | Token address (`address(0)` for ETH) |
| amount | uint256 | Amount to deposit (ignored for ETH, uses msg.value) |

**Emits**: `AdminPoolOperation` with `AdminPoolOpType.POOL_DEPOSIT`

### Multi-Sig Proposal Functions

#### `createProposal()` (Admin only)
```solidity
function createProposal(
    OperationType opType,
    bytes calldata params,
    uint256 deadline
) external returns (uint256 proposalId)
```
Create a new multi-sig proposal. Creator auto-confirms.

| Parameter | Type | Description |
|-----------|------|-------------|
| opType | OperationType | Operation type enum |
| params | bytes | ABI-encoded parameters |
| deadline | uint256 | Proposal expiration timestamp |

**Deadline Constraints**:
- Minimum: `block.timestamp + 1 hour`
- Maximum: `block.timestamp + 30 days`

**Emits**: `ProposalCreated`, `ProposalConfirmed`

#### `confirmProposal()` (Admin only)
```solidity
function confirmProposal(uint256 proposalId) external
```
Confirm an existing proposal.

**Emits**: `ProposalConfirmed`

#### `revokeConfirmation()` (Admin only)
```solidity
function revokeConfirmation(uint256 proposalId) external
```
Revoke a previous confirmation.

**Emits**: `ProposalRevoked`

#### `cancelProposal()` (Proposer only)
```solidity
function cancelProposal(uint256 proposalId) external
```
Cancel a proposal (only by original proposer).

**Emits**: `ProposalCancelled`

#### `executeProposal()` (Admin only)
```solidity
function executeProposal(uint256 proposalId) external
```
Execute a proposal that has reached threshold.

**Requirements**:
- `confirmCount >= threshold`
- Not expired
- Not already executed or cancelled

**Emits**: `ProposalExecuted`, plus operation-specific events

---

## Data Types

### Enums

#### `TxType`
```solidity
enum TxType {
    NONE,        // 0: Reserved / Invalid
    PAYMENT,     // 1: User payment
    WITHDRAWAL   // 2: User withdrawal
}
```

#### `AdminPoolOpType`
```solidity
enum AdminPoolOpType {
    NONE,                // 0: Reserved / Invalid
    ADMIN_WITHDRAWAL,    // 1: Admin withdraws from payment pool
    POOL_DEPOSIT,        // 2: Admin deposits to withdrawal pool
    POOL_WITHDRAW,       // 3: Admin withdraws from withdrawal pool
    EMERGENCY_WITHDRAW   // 4: Emergency withdrawal
}
```

#### `OperationType`
```solidity
enum OperationType {
    SetSigner,           // 0: Set new signer address
    AddAdmin,            // 1: Add new admin
    RemoveAdmin,         // 2: Remove admin
    ChangeThreshold,     // 3: Change multi-sig threshold
    AdminWithdraw,       // 4: Withdraw from payment pool
    WithdrawFromPool,    // 5: Withdraw from withdrawal pool
    Pause,               // 6: Pause the project
    Unpause,             // 7: Unpause the project
    EmergencyWithdraw    // 8: Emergency withdraw all funds
}
```

### Proposal Parameters Encoding

| Operation | Parameters | Encoding |
|-----------|------------|----------|
| SetSigner | `address newSigner` | `abi.encode(newSigner)` |
| AddAdmin | `address newAdmin` | `abi.encode(newAdmin)` |
| RemoveAdmin | `address admin` | `abi.encode(admin)` |
| ChangeThreshold | `uint256 newThreshold` | `abi.encode(newThreshold)` |
| AdminWithdraw | `address token, uint256 amount, address recipient` | `abi.encode(token, amount, recipient)` |
| WithdrawFromPool | `address token, uint256 amount, address recipient` | `abi.encode(token, amount, recipient)` |
| Pause | (none) | `""` |
| Unpause | (none) | `""` |
| EmergencyWithdraw | `address token, address recipient` | `abi.encode(token, recipient)` |

---

## Events

### Factory Events

```solidity
event ProjectCreated(
    string indexed projectId,
    address indexed projectAddress,
    address indexed creator,
    address admin,
    string name
);

event FeeVaultUpdated(address indexed oldVault, address indexed newVault);
event FeeRateUpdated(uint256 oldRate, uint256 newRate);
event BeaconUpgraded(address indexed oldImpl, address indexed newImpl);
event OwnershipTransferCancelled(address indexed owner);
```

### Project Events

```solidity
// User transactions
event PayTheFlyTransaction(
    string projectId,
    address indexed token,
    address indexed account,
    uint256 amount,
    uint256 fee,
    string serialNo,
    TxType indexed txType
);

// Admin pool operations
event AdminPoolOperation(
    string projectId,
    address indexed token,
    address indexed recipient,
    uint256 amount,
    uint256 indexed proposalId,
    AdminPoolOpType opType
);

// Proposal lifecycle
event ProposalCreated(uint256 indexed proposalId, OperationType opType, address indexed proposer, uint256 deadline);
event ProposalConfirmed(uint256 indexed proposalId, address indexed admin);
event ProposalRevoked(uint256 indexed proposalId, address indexed admin);
event ProposalCancelled(uint256 indexed proposalId);
event ProposalExecuted(uint256 indexed proposalId);

// Admin management
event AdminAdded(address indexed admin, uint256 indexed proposalId);
event AdminRemoved(address indexed admin, uint256 indexed proposalId);
event ThresholdChanged(uint256 oldThreshold, uint256 newThreshold, uint256 indexed proposalId);
event SignerUpdated(address indexed oldSigner, address indexed newSigner, uint256 indexed proposalId);

// Project state
event ProjectNameUpdated(string oldName, string newName);
event ProjectPaused(uint256 indexed proposalId);
event ProjectUnpaused(uint256 indexed proposalId);
```

---

## Errors

### Factory Errors
```solidity
error ProjectIdEmpty();
error ProjectIdTooLong();
error ProjectAlreadyExists();
error InvalidAdminAddress();
error InvalidFeeVault();
error FeeRateTooHigh();
error InvalidSignerAddress();
error InvalidImplementation();
```

### Project Errors
```solidity
error NotAdmin();
error NotFactory();
error ProjectPausedError();
error InvalidSignature();
error ExpiredDeadline();
error SerialNoUsed();
error SerialNoTooLong();
error SerialNoEmpty();
error InsufficientBalance();
error InvalidAmount();
error InvalidAddress();
error InvalidThreshold();
error MaxAdminsReached();
error AdminAlreadyExists();
error AdminNotFound();
error ThresholdTooHigh();
error NameEmpty();
error NameTooLong();
error TransferFailed();
error DirectTransferNotAllowed();
```

### Proposal Errors
```solidity
error ProposalNotFound();
error ProposalExpired();
error ProposalAlreadyExecuted();
error ProposalCancelledError();
error AlreadyConfirmed();
error NotConfirmed();
error NotProposer();
error ThresholdNotReached();
error InvalidProposalDuration();
error InvalidOperationType();
```

---

## EIP-712 Signatures

### Domain Separator
```solidity
{
    name: "PayTheFlyPro",
    version: "1",
    chainId: <current chain id>,
    verifyingContract: <project contract address>
}
```

### Payment Request Type Hash
```
PaymentRequest(string projectId,address token,uint256 amount,string serialNo,uint256 deadline)
```

### Withdrawal Request Type Hash
```
WithdrawalRequest(address user,string projectId,address token,uint256 amount,string serialNo,uint256 deadline)
```

### Signing Example (ethers.js v6)
```javascript
const domain = {
    name: "PayTheFlyPro",
    version: "1",
    chainId: 1,
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
    projectId: "my-project",
    token: "0x0000000000000000000000000000000000000000",
    amount: ethers.parseEther("1.0"),
    serialNo: "PAY-001",
    deadline: Math.floor(Date.now() / 1000) + 3600
};

const signature = await signer.signTypedData(domain, types, value);
```

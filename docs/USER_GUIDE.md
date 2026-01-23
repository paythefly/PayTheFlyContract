# PayTheFlyPro User Guide

## Table of Contents

1. [Quick Start](#quick-start)
2. [Project Management](#project-management)
3. [Payment Flow](#payment-flow)
4. [Withdrawal Flow](#withdrawal-flow)
5. [Multi-Sig Governance](#multi-sig-governance)
6. [Integration Examples](#integration-examples)

---

## Quick Start

### Prerequisites

- Node.js 18+
- Hardhat
- ethers.js v6

### Installation

```bash
npm install
npx hardhat compile
```

### Connect to Deployed Contracts

```javascript
const { ethers } = require("ethers");

// Connect to provider
const provider = new ethers.JsonRpcProvider("YOUR_RPC_URL");
const signer = new ethers.Wallet("YOUR_PRIVATE_KEY", provider);

// Load contract ABIs
const factoryABI = require("./artifacts/contracts/PayTheFlyProFactory.sol/PayTheFlyProFactory.json").abi;
const projectABI = require("./artifacts/contracts/PayTheFlyPro.sol/PayTheFlyPro.json").abi;

// Connect to factory
const factory = new ethers.Contract(FACTORY_ADDRESS, factoryABI, signer);

// Connect to project
const projectAddress = await factory.getProject("my-project-id");
const project = new ethers.Contract(projectAddress, projectABI, signer);
```

---

## Project Management

### Create a New Project

```javascript
async function createProject() {
    const projectId = "my-unique-project-id";
    const name = "My DApp Project";
    const admin = "0x...";  // Initial admin address
    const signer = "0x..."; // Signer for payment/withdrawal verification

    const tx = await factory.createProject(projectId, name, admin, signer);
    const receipt = await tx.wait();

    // Get project address from event
    const event = receipt.logs.find(
        log => log.topics[0] === factory.interface.getEvent("ProjectCreated").topicHash
    );
    const decoded = factory.interface.parseLog(event);
    console.log("Project created at:", decoded.args.projectAddress);
}
```

### Get Project Information

```javascript
async function getProjectInfo() {
    const info = await project.getProjectInfo();

    console.log("Project ID:", info.projectId);
    console.log("Name:", info.name);
    console.log("Creator:", info.creator);
    console.log("Signer:", info.signer);
    console.log("Paused:", info.paused);
    console.log("Admins:", info.admins);
    console.log("Threshold:", info.threshold.toString());
    console.log("Active Proposals:", info.activeProposalCount.toString());
}
```

### Check Balances

```javascript
async function checkBalances() {
    const ETH = ethers.ZeroAddress;
    const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

    // Single token balance
    const ethBalance = await project.getBalance(ETH);
    console.log("ETH Payment Pool:", ethers.formatEther(ethBalance.paymentBalance));
    console.log("ETH Withdrawal Pool:", ethers.formatEther(ethBalance.withdrawalBalance));

    // Batch query
    const balances = await project.getBalancesBatch([ETH, USDT]);
    console.log("Balances:", balances);
}
```

---

## Payment Flow

### Flow Diagram

```
┌─────────┐    1. Request Payment    ┌──────────┐
│  User   │ ─────────────────────▶  │  Backend │
└─────────┘                          └──────────┘
     │                                     │
     │                                     │ 2. Generate Signature
     │                                     │    (using project signer key)
     │                                     ▼
     │                              ┌──────────┐
     │  3. Return signed request    │  Signer  │
     │ ◀─────────────────────────── │  Wallet  │
     │                              └──────────┘
     │
     │ 4. Submit payment transaction
     ▼
┌──────────────┐
│ PayTheFlyPro │  5. Verify signature
│   Contract   │  6. Transfer funds
│              │  7. Deduct fee
│              │  8. Emit event
└──────────────┘
```

### Backend: Generate Payment Signature

```javascript
const { ethers } = require("ethers");

async function generatePaymentSignature(signerPrivateKey, projectAddress, paymentData) {
    const signer = new ethers.Wallet(signerPrivateKey);

    // Get chain ID
    const provider = new ethers.JsonRpcProvider("YOUR_RPC_URL");
    const chainId = (await provider.getNetwork()).chainId;

    // EIP-712 domain
    const domain = {
        name: "PayTheFlyPro",
        version: "1",
        chainId: chainId,
        verifyingContract: projectAddress
    };

    // Type definition
    const types = {
        PaymentRequest: [
            { name: "projectId", type: "string" },
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "serialNo", type: "string" },
            { name: "deadline", type: "uint256" }
        ]
    };

    // Payment data
    const value = {
        projectId: paymentData.projectId,
        token: paymentData.token,
        amount: paymentData.amount,
        serialNo: paymentData.serialNo,
        deadline: paymentData.deadline
    };

    // Sign
    const signature = await signer.signTypedData(domain, types, value);

    return {
        request: value,
        signature: signature
    };
}

// Usage
const payment = await generatePaymentSignature(
    SIGNER_PRIVATE_KEY,
    PROJECT_ADDRESS,
    {
        projectId: "my-project",
        token: ethers.ZeroAddress,  // ETH
        amount: ethers.parseEther("1.0"),
        serialNo: `PAY-${Date.now()}`,
        deadline: Math.floor(Date.now() / 1000) + 3600  // 1 hour
    }
);
```

### Frontend: Submit Payment

```javascript
async function submitPayment(project, paymentRequest, signature) {
    // For ETH payment
    if (paymentRequest.token === ethers.ZeroAddress) {
        const tx = await project.pay(
            [
                paymentRequest.token,
                paymentRequest.amount,
                paymentRequest.serialNo,
                paymentRequest.deadline
            ],
            signature,
            { value: paymentRequest.amount }
        );
        return await tx.wait();
    }

    // For ERC20 payment
    else {
        // First approve
        const token = new ethers.Contract(paymentRequest.token, ERC20_ABI, signer);
        await (await token.approve(project.target, paymentRequest.amount)).wait();

        // Then pay
        const tx = await project.pay(
            [
                paymentRequest.token,
                paymentRequest.amount,
                paymentRequest.serialNo,
                paymentRequest.deadline
            ],
            signature
        );
        return await tx.wait();
    }
}
```

---

## Withdrawal Flow

### Flow Diagram

```
┌─────────┐  1. Request Withdrawal   ┌──────────┐
│  User   │ ─────────────────────▶  │  Backend │
└─────────┘                          └──────────┘
     │                                     │
     │                                     │ 2. Verify eligibility
     │                                     │ 3. Generate Signature
     │                                     ▼
     │                              ┌──────────┐
     │  4. Return signed request    │  Signer  │
     │ ◀─────────────────────────── │  Wallet  │
     │                              └──────────┘
     │
     │ 5. Submit withdrawal transaction
     │    (user field must match msg.sender)
     ▼
┌──────────────┐
│ PayTheFlyPro │  6. Verify signature
│   Contract   │  7. Check user == msg.sender
│              │  8. Transfer from withdrawal pool
│              │  9. Emit event
└──────────────┘
```

### Backend: Generate Withdrawal Signature

```javascript
async function generateWithdrawalSignature(signerPrivateKey, projectAddress, withdrawalData) {
    const signer = new ethers.Wallet(signerPrivateKey);

    const chainId = (await provider.getNetwork()).chainId;

    const domain = {
        name: "PayTheFlyPro",
        version: "1",
        chainId: chainId,
        verifyingContract: projectAddress
    };

    const types = {
        WithdrawalRequest: [
            { name: "user", type: "address" },
            { name: "projectId", type: "string" },
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "serialNo", type: "string" },
            { name: "deadline", type: "uint256" }
        ]
    };

    const value = {
        user: withdrawalData.user,  // MUST match the user who will call withdraw()
        projectId: withdrawalData.projectId,
        token: withdrawalData.token,
        amount: withdrawalData.amount,
        serialNo: withdrawalData.serialNo,
        deadline: withdrawalData.deadline
    };

    const signature = await signer.signTypedData(domain, types, value);

    return { request: value, signature };
}
```

### Frontend: Submit Withdrawal

```javascript
async function submitWithdrawal(project, withdrawalRequest, signature) {
    // User field must match connected wallet
    if (withdrawalRequest.user.toLowerCase() !== (await signer.getAddress()).toLowerCase()) {
        throw new Error("User mismatch - cannot withdraw for another user");
    }

    const tx = await project.withdraw(
        [
            withdrawalRequest.user,
            withdrawalRequest.token,
            withdrawalRequest.amount,
            withdrawalRequest.serialNo,
            withdrawalRequest.deadline
        ],
        signature
    );
    return await tx.wait();
}
```

---

## Multi-Sig Governance

### Understanding Multi-Sig

Multi-sig requires multiple admin confirmations before executing sensitive operations.

```
Threshold = 2, Admins = [A, B, C]

1. Admin A creates proposal (auto-confirms) → confirmCount = 1
2. Admin B confirms                         → confirmCount = 2 ✓
3. Any admin executes                       → Operation performed
```

### Available Operations

| Operation | Description | Parameters |
|-----------|-------------|------------|
| SetSigner | Change payment/withdrawal signer | `address newSigner` |
| AddAdmin | Add new admin | `address newAdmin` |
| RemoveAdmin | Remove admin | `address admin` |
| ChangeThreshold | Change confirmation threshold | `uint256 newThreshold` |
| AdminWithdraw | Withdraw from payment pool | `address token, uint256 amount, address recipient` |
| WithdrawFromPool | Withdraw from withdrawal pool | `address token, uint256 amount, address recipient` |
| Pause | Pause project | (none) |
| Unpause | Unpause project | (none) |
| EmergencyWithdraw | Withdraw all funds | `address token, address recipient` |

### Create a Proposal

```javascript
async function createAdminWithdrawProposal() {
    const OperationType = {
        SetSigner: 0,
        AddAdmin: 1,
        RemoveAdmin: 2,
        ChangeThreshold: 3,
        AdminWithdraw: 4,
        WithdrawFromPool: 5,
        Pause: 6,
        Unpause: 7,
        EmergencyWithdraw: 8
    };

    // Encode parameters
    const params = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address"],
        [
            ethers.ZeroAddress,           // token (ETH)
            ethers.parseEther("10"),      // amount
            "0xRecipientAddress..."       // recipient
        ]
    );

    // Set deadline (7 days from now)
    const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    const tx = await project.createProposal(
        OperationType.AdminWithdraw,
        params,
        deadline
    );

    const receipt = await tx.wait();
    const event = receipt.logs.find(log =>
        log.topics[0] === project.interface.getEvent("ProposalCreated").topicHash
    );
    const proposalId = project.interface.parseLog(event).args.proposalId;

    console.log("Proposal created with ID:", proposalId.toString());
    return proposalId;
}
```

### Confirm a Proposal

```javascript
async function confirmProposal(proposalId) {
    const tx = await project.confirmProposal(proposalId);
    await tx.wait();
    console.log("Proposal confirmed");
}
```

### Execute a Proposal

```javascript
async function executeProposal(proposalId) {
    // Check if threshold is reached
    const proposal = await project.getProposal(proposalId);
    const threshold = await project.getThreshold();

    if (proposal.confirmCount < threshold) {
        throw new Error(`Need ${threshold - proposal.confirmCount} more confirmations`);
    }

    if (proposal.executed) {
        throw new Error("Proposal already executed");
    }

    if (proposal.cancelled) {
        throw new Error("Proposal was cancelled");
    }

    if (Date.now() / 1000 > proposal.deadline) {
        throw new Error("Proposal expired");
    }

    const tx = await project.executeProposal(proposalId);
    await tx.wait();
    console.log("Proposal executed successfully");
}
```

### Full Multi-Sig Example

```javascript
async function multiSigWithdrawFlow() {
    // Assuming 2-of-3 multi-sig
    const [admin1, admin2, admin3] = [signer1, signer2, signer3];

    // Step 1: Admin1 creates proposal (auto-confirms)
    const project1 = project.connect(admin1);
    const params = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address"],
        [ethers.ZeroAddress, ethers.parseEther("5"), recipientAddress]
    );
    const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    const tx1 = await project1.createProposal(4, params, deadline); // 4 = AdminWithdraw
    const receipt1 = await tx1.wait();
    const proposalId = /* extract from event */;

    console.log("Proposal created, confirmCount = 1");

    // Step 2: Admin2 confirms
    const project2 = project.connect(admin2);
    await (await project2.confirmProposal(proposalId)).wait();
    console.log("Admin2 confirmed, confirmCount = 2, threshold reached!");

    // Step 3: Any admin executes
    await (await project1.executeProposal(proposalId)).wait();
    console.log("Proposal executed, funds transferred!");
}
```

---

## Integration Examples

### Complete Payment Integration

```javascript
// Backend service
class PaymentService {
    constructor(signerPrivateKey, factoryAddress, provider) {
        this.signer = new ethers.Wallet(signerPrivateKey, provider);
        this.factory = new ethers.Contract(factoryAddress, factoryABI, this.signer);
        this.provider = provider;
    }

    async createPaymentRequest(projectId, token, amount, userId) {
        const projectAddress = await this.factory.getProject(projectId);
        if (projectAddress === ethers.ZeroAddress) {
            throw new Error("Project not found");
        }

        const serialNo = `PAY-${projectId}-${userId}-${Date.now()}`;
        const deadline = Math.floor(Date.now() / 1000) + 3600;
        const chainId = (await this.provider.getNetwork()).chainId;

        const domain = {
            name: "PayTheFlyPro",
            version: "1",
            chainId,
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

        const value = { projectId, token, amount, serialNo, deadline };
        const signature = await this.signer.signTypedData(domain, types, value);

        return {
            projectAddress,
            request: value,
            signature
        };
    }
}

// Usage
const paymentService = new PaymentService(SIGNER_KEY, FACTORY_ADDRESS, provider);
const paymentData = await paymentService.createPaymentRequest(
    "my-project",
    ethers.ZeroAddress,
    ethers.parseEther("1.0"),
    "user-123"
);

// Return to frontend for user to submit
```

### Event Monitoring

```javascript
async function monitorProjectEvents(project) {
    // Listen for payments
    project.on("PayTheFlyTransaction", (projectId, token, account, amount, fee, serialNo, txType) => {
        if (txType === 1n) { // PAYMENT
            console.log(`Payment received: ${ethers.formatEther(amount)} from ${account}`);
        } else if (txType === 2n) { // WITHDRAWAL
            console.log(`Withdrawal processed: ${ethers.formatEther(amount)} to ${account}`);
        }
    });

    // Listen for admin operations
    project.on("AdminPoolOperation", (projectId, token, recipient, amount, proposalId, opType) => {
        const opNames = ["NONE", "ADMIN_WITHDRAWAL", "POOL_DEPOSIT", "POOL_WITHDRAW", "EMERGENCY_WITHDRAW"];
        console.log(`Admin operation: ${opNames[opType]} - ${ethers.formatEther(amount)}`);
    });

    // Listen for proposals
    project.on("ProposalCreated", (proposalId, opType, proposer, deadline) => {
        console.log(`New proposal #${proposalId} by ${proposer}`);
    });

    project.on("ProposalExecuted", (proposalId) => {
        console.log(`Proposal #${proposalId} executed`);
    });
}
```

---

## Best Practices

### Security

1. **Protect Signer Private Key**: Store securely (HSM, KMS, or secure vault)
2. **Validate Serial Numbers**: Ensure uniqueness before signing
3. **Short Deadlines**: Use reasonable deadlines (1 hour for payments)
4. **Multi-Sig Threshold**: Set appropriate threshold (e.g., 2-of-3 for small teams)

### Performance

1. **Batch Queries**: Use `getBalancesBatch()` for multiple tokens
2. **Pagination**: Use `getProposalsPaginated()` for large proposal lists
3. **Event Indexing**: Index events for historical queries

### Error Handling

```javascript
try {
    await project.pay(request, signature, { value: amount });
} catch (error) {
    if (error.reason === "SerialNoUsed") {
        console.error("Serial number already used");
    } else if (error.reason === "ExpiredDeadline") {
        console.error("Payment request expired");
    } else if (error.reason === "InvalidSignature") {
        console.error("Invalid signature");
    } else {
        console.error("Payment failed:", error);
    }
}
```

---

## Next Steps

- [Technical Architecture](./TECHNICAL_ARCHITECTURE.md)
- [API Reference](./API_REFERENCE.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)

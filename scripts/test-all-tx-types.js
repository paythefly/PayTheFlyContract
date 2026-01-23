const { ethers, upgrades } = require("hardhat");

const PAYMENT_TYPES = {
    PaymentRequest: [
        { name: "projectId", type: "string" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "serialNo", type: "string" },
        { name: "deadline", type: "uint256" }
    ]
};

const WITHDRAWAL_TYPES = {
    WithdrawalRequest: [
        { name: "user", type: "address" },
        { name: "projectId", type: "string" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "serialNo", type: "string" },
        { name: "deadline", type: "uint256" }
    ]
};

async function getDomain(projectAddress) {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    return {
        name: "PayTheFlyPro",
        version: "1",
        chainId: chainId,
        verifyingContract: projectAddress
    };
}

async function signPayment(signer, projectAddress, projectId, payment) {
    const domain = await getDomain(projectAddress);
    const fullPayment = { projectId: projectId, ...payment };
    return signer.signTypedData(domain, PAYMENT_TYPES, fullPayment);
}

async function signWithdrawal(signer, projectAddress, projectId, withdrawal) {
    const domain = await getDomain(projectAddress);
    const fullWithdrawal = { projectId: projectId, user: withdrawal.user, ...withdrawal };
    return signer.signTypedData(domain, WITHDRAWAL_TYPES, fullWithdrawal);
}

async function main() {
    const signers = await ethers.getSigners();
    console.log("Available signers:", signers.length);

    const owner = signers[0];
    const admin = owner;
    const projectSigner = owner;
    const feeVault = owner;
    const user = owner;

    console.log("Deploying contracts with account:", owner.address);

    // Deploy MockERC20 as token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Test Token", "TT", 18);
    await token.waitForDeployment();
    console.log("MockERC20 deployed to:", await token.getAddress());

    // Deploy Project implementation
    const Project = await ethers.getContractFactory("PayTheFlyPro");
    const projectImpl = await Project.deploy();
    await projectImpl.waitForDeployment();
    console.log("PayTheFlyPro implementation deployed to:", await projectImpl.getAddress());

    // Deploy Factory (upgradeable)
    const FEE_RATE = 100; // 1%
    const Factory = await ethers.getContractFactory("PayTheFlyProFactory");
    const factory = await upgrades.deployProxy(
        Factory,
        [await projectImpl.getAddress(), feeVault.address, FEE_RATE],
        { kind: "uups" }
    );
    await factory.waitForDeployment();
    console.log("PayTheFlyProFactory deployed to:", await factory.getAddress());

    // Create a project
    const projectId = "test-project-001";
    const projectName = "Test Project";
    const createTx = await factory.createProject(projectId, projectName, admin.address, projectSigner.address);
    await createTx.wait();

    const projectAddress = await factory.getProject(projectId);
    console.log("Project created at:", projectAddress);

    const project = await ethers.getContractAt("PayTheFlyPro", projectAddress);

    // Mint tokens to user and admin
    const amount = ethers.parseEther("10000");
    await token.mint(user.address, amount);
    await token.mint(admin.address, amount);
    console.log("Minted tokens to user and admin");

    // Approve project
    await token.connect(user).approve(projectAddress, amount);
    await token.connect(admin).approve(projectAddress, amount);
    console.log("Approved project to spend tokens");

    const latestBlock = await ethers.provider.getBlock("latest");
    const deadline = latestBlock.timestamp + 3600;

    console.log("\n========================================");
    console.log("Testing All Transaction Types");
    console.log("========================================");

    // ==========================================
    // 1. PAYMENT (TxType = 1)
    // ==========================================
    console.log("\n=== 1. PAYMENT (TxType=1) ===");
    const payAmount = ethers.parseEther("100");
    const paySerialNo = "PAY_" + Date.now();

    const payment = {
        token: await token.getAddress(),
        amount: payAmount,
        serialNo: paySerialNo,
        deadline: deadline
    };
    const paySignature = await signPayment(projectSigner, projectAddress, projectId, payment);
    const payTx = await project.connect(user).pay(payment, paySignature);
    const payReceipt = await payTx.wait();
    console.log("PAYMENT tx block:", payReceipt.blockNumber);
    console.log("Serial:", paySerialNo);

    // ==========================================
    // 2. WITHDRAWAL (TxType = 2) - User withdrawal with signature
    // ==========================================
    console.log("\n=== 2. WITHDRAWAL (TxType=2) ===");

    // First, admin needs to deposit to withdrawal pool
    const depositAmount = ethers.parseEther("500");
    await project.connect(admin).depositToWithdrawalPool(await token.getAddress(), depositAmount);
    console.log("Admin deposited to withdrawal pool:", ethers.formatEther(depositAmount), "TT");

    const withdrawAmount = ethers.parseEther("50");
    const withdrawSerialNo = "WITHDRAW_" + Date.now();

    const withdrawal = {
        user: user.address,
        token: await token.getAddress(),
        amount: withdrawAmount,
        serialNo: withdrawSerialNo,
        deadline: deadline
    };
    const withdrawSignature = await signWithdrawal(projectSigner, projectAddress, projectId, withdrawal);
    const withdrawTx = await project.connect(user).withdraw(withdrawal, withdrawSignature);
    const withdrawReceipt = await withdrawTx.wait();
    console.log("WITHDRAWAL tx block:", withdrawReceipt.blockNumber);
    console.log("Serial:", withdrawSerialNo);

    // ==========================================
    // 3. ADMIN_WITHDRAWAL (TxType = 3) - via multi-sig proposal
    // ==========================================
    console.log("\n=== 3. ADMIN_WITHDRAWAL (TxType=3) ===");

    // Create proposal for admin withdrawal from payment pool
    // OperationType.AdminWithdraw = 4
    // Note: Payment pool has ~99 TT from the 100 TT payment (after 1% fee)
    // Params order: (token, amount, recipient)
    const adminWithdrawAmount = ethers.parseEther("50");
    const adminWithdrawParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address"],
        [await token.getAddress(), adminWithdrawAmount, admin.address]
    );
    const proposalDeadline = deadline + 7200; // 2 hours from now

    const adminWithdrawProposalTx = await project.connect(admin).createProposal(4, adminWithdrawParams, proposalDeadline);
    const adminWithdrawProposalReceipt = await adminWithdrawProposalTx.wait();
    const proposalCount = await project.getProposalCount();
    const adminWithdrawProposalId = proposalCount - 1n;
    console.log("Created admin withdraw proposal:", adminWithdrawProposalId.toString());

    // Execute directly (auto-confirmed since threshold=1 with single admin)
    const execTx = await project.connect(admin).executeProposal(adminWithdrawProposalId);
    const execReceipt = await execTx.wait();
    console.log("ADMIN_WITHDRAWAL tx block:", execReceipt.blockNumber);

    // ==========================================
    // 4. POOL_DEPOSIT (TxType = 4)
    // ==========================================
    console.log("\n=== 4. POOL_DEPOSIT (TxType=4) ===");

    // ERC20 deposit
    const poolDepositAmount = ethers.parseEther("200");
    const poolDepositTx = await project.connect(admin).depositToWithdrawalPool(await token.getAddress(), poolDepositAmount);
    const poolDepositReceipt = await poolDepositTx.wait();
    console.log("POOL_DEPOSIT (ERC20) tx block:", poolDepositReceipt.blockNumber);

    // ETH deposit
    const ethDepositAmount = ethers.parseEther("1");
    const ethPoolDepositTx = await project.connect(admin).depositToWithdrawalPool(ethers.ZeroAddress, 0, { value: ethDepositAmount });
    const ethPoolDepositReceipt = await ethPoolDepositTx.wait();
    console.log("POOL_DEPOSIT (ETH) tx block:", ethPoolDepositReceipt.blockNumber);

    // ==========================================
    // 5. POOL_WITHDRAW (TxType = 5) - via multi-sig proposal
    // ==========================================
    console.log("\n=== 5. POOL_WITHDRAW (TxType=5) ===");

    // OperationType.WithdrawFromPool = 5
    // Params order: (token, amount, recipient)
    const poolWithdrawAmount = ethers.parseEther("30");
    const poolWithdrawParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "address"],
        [await token.getAddress(), poolWithdrawAmount, admin.address]
    );

    const poolWithdrawProposalTx = await project.connect(admin).createProposal(5, poolWithdrawParams, proposalDeadline);
    await poolWithdrawProposalTx.wait();
    const poolWithdrawProposalId = (await project.getProposalCount()) - 1n;
    console.log("Created pool withdraw proposal:", poolWithdrawProposalId.toString());

    // Execute directly (auto-confirmed since threshold=1 with single admin)
    const poolWithdrawExecTx = await project.connect(admin).executeProposal(poolWithdrawProposalId);
    const poolWithdrawExecReceipt = await poolWithdrawExecTx.wait();
    console.log("POOL_WITHDRAW tx block:", poolWithdrawExecReceipt.blockNumber);

    // ==========================================
    // 6. EMERGENCY_WITHDRAW (TxType = 6) - via multi-sig proposal
    // ==========================================
    console.log("\n=== 6. EMERGENCY_WITHDRAW (TxType=6) ===");

    // First pause the contract - OperationType.Pause = 6
    const pauseProposalTx = await project.connect(admin).createProposal(6, "0x", proposalDeadline);
    await pauseProposalTx.wait();
    const pauseProposalId = (await project.getProposalCount()) - 1n;
    // Execute directly (auto-confirmed since threshold=1 with single admin)
    await project.connect(admin).executeProposal(pauseProposalId);
    console.log("Contract paused");

    // Emergency withdraw - OperationType.EmergencyWithdraw = 8
    const emergencyWithdrawParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address"],
        [await token.getAddress(), admin.address]
    );

    const emergencyProposalTx = await project.connect(admin).createProposal(8, emergencyWithdrawParams, proposalDeadline);
    await emergencyProposalTx.wait();
    const emergencyProposalId = (await project.getProposalCount()) - 1n;
    console.log("Created emergency withdraw proposal:", emergencyProposalId.toString());

    // Execute directly (auto-confirmed since threshold=1 with single admin)
    const emergencyExecTx = await project.connect(admin).executeProposal(emergencyProposalId);
    const emergencyExecReceipt = await emergencyExecTx.wait();
    console.log("EMERGENCY_WITHDRAW tx block:", emergencyExecReceipt.blockNumber);

    // ==========================================
    // Summary
    // ==========================================
    console.log("\n========================================");
    console.log("Summary - All Transaction Types Generated");
    console.log("========================================");
    console.log("Factory:", await factory.getAddress());
    console.log("Project:", projectAddress);
    console.log("Token:", await token.getAddress());
    console.log("\nTransaction Types:");
    console.log("  1. PAYMENT       - Block", payReceipt.blockNumber);
    console.log("  2. WITHDRAWAL    - Block", withdrawReceipt.blockNumber);
    console.log("  3. ADMIN_WITHDRAW- Block", execReceipt.blockNumber);
    console.log("  4. POOL_DEPOSIT  - Block", poolDepositReceipt.blockNumber, "(ERC20),", ethPoolDepositReceipt.blockNumber, "(ETH)");
    console.log("  5. POOL_WITHDRAW - Block", poolWithdrawExecReceipt.blockNumber);
    console.log("  6. EMERGENCY     - Block", emergencyExecReceipt.blockNumber);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

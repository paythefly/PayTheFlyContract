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
    console.log("Testing User Transaction Types");
    console.log("(PayTheFlyTransaction event only)");
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
    console.log("PAYMENT tx hash:", payTx.hash);
    console.log("PAYMENT tx block:", payReceipt.blockNumber);
    console.log("Serial:", paySerialNo);

    // ==========================================
    // 2. WITHDRAWAL (TxType = 2)
    // ==========================================
    console.log("\n=== 2. WITHDRAWAL (TxType=2) ===");

    // First, admin needs to deposit to withdrawal pool
    const depositAmount = ethers.parseEther("500");
    const depositTx = await project.connect(admin).depositToWithdrawalPool(await token.getAddress(), depositAmount);
    await depositTx.wait();
    console.log("Admin deposited to withdrawal pool:", ethers.formatEther(depositAmount), "TT");
    console.log("(Note: depositToWithdrawalPool emits AdminPoolOperation, not PayTheFlyTransaction)");

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
    console.log("WITHDRAWAL tx hash:", withdrawTx.hash);
    console.log("WITHDRAWAL tx block:", withdrawReceipt.blockNumber);
    console.log("Serial:", withdrawSerialNo);

    // ==========================================
    // Additional PAYMENT for more test data
    // ==========================================
    console.log("\n=== 3. Additional PAYMENT (TxType=1) ===");
    const payAmount2 = ethers.parseEther("200");
    const paySerialNo2 = "PAY2_" + Date.now();

    const payment2 = {
        token: await token.getAddress(),
        amount: payAmount2,
        serialNo: paySerialNo2,
        deadline: deadline
    };
    const paySignature2 = await signPayment(projectSigner, projectAddress, projectId, payment2);
    const payTx2 = await project.connect(user).pay(payment2, paySignature2);
    const payReceipt2 = await payTx2.wait();
    console.log("PAYMENT tx hash:", payTx2.hash);
    console.log("PAYMENT tx block:", payReceipt2.blockNumber);
    console.log("Serial:", paySerialNo2);

    // ==========================================
    // Summary
    // ==========================================
    console.log("\n========================================");
    console.log("Summary - PayTheFlyTransaction Events");
    console.log("========================================");
    console.log("Factory:", await factory.getAddress());
    console.log("Project:", projectAddress);
    console.log("Token:", await token.getAddress());
    console.log("\nExpected PayTheFlyTransaction events:");
    console.log("  1. PAYMENT (TxType=1)    - Block", payReceipt.blockNumber, "- Serial:", paySerialNo);
    console.log("  2. WITHDRAWAL (TxType=2) - Block", withdrawReceipt.blockNumber, "- Serial:", withdrawSerialNo);
    console.log("  3. PAYMENT (TxType=1)    - Block", payReceipt2.blockNumber, "- Serial:", paySerialNo2);
    console.log("\nNote: Admin operations (depositToWithdrawalPool) emit AdminPoolOperation event,");
    console.log("      which is NOT recorded in chain_tx table.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

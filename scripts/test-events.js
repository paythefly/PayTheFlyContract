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
    const fullPayment = {
        projectId: projectId,
        ...payment
    };
    return signer.signTypedData(domain, PAYMENT_TYPES, fullPayment);
}

async function main() {
    const signers = await ethers.getSigners();
    console.log("Available signers:", signers.length);
    
    // Use same account for all roles for simplicity  
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

    // Get project contract instance
    const project = await ethers.getContractAt("PayTheFlyPro", projectAddress);

    // Mint tokens to user
    const amount = ethers.parseEther("1000");
    await token.mint(user.address, amount);
    console.log("Minted 1000 tokens to user");

    // Approve project to spend tokens
    await token.connect(user).approve(projectAddress, amount);
    console.log("User approved project to spend tokens");

    // Get deadline
    const latestBlock = await ethers.provider.getBlock("latest");
    const deadline = latestBlock.timestamp + 3600;

    // Make a payment with ERC20 token - this will emit PayTheFlyTransaction event!
    const payAmount = ethers.parseEther("100");
    const serialNo = "PAY_" + Date.now();
    console.log("\n=== Making ERC20 payment ===");
    console.log("Serial No:", serialNo);
    console.log("Amount:", payAmount.toString());

    const payment = {
        token: await token.getAddress(),
        amount: payAmount,
        serialNo: serialNo,
        deadline: deadline
    };

    const signature = await signPayment(projectSigner, projectAddress, projectId, payment);
    
    const payTx = await project.connect(user).pay(
        payment,
        signature
    );
    const payReceipt = await payTx.wait();
    console.log("Payment tx hash:", payReceipt.hash);
    console.log("Payment tx block:", payReceipt.blockNumber);

    // Log the events
    for (const log of payReceipt.logs) {
        try {
            const parsed = project.interface.parseLog(log);
            if (parsed && parsed.name === "PayTheFlyTransaction") {
                console.log("\n=== PayTheFlyTransaction Event ===");
                console.log("  Contract (log.address):", log.address);
                console.log("  projectId:", parsed.args.projectId);
                console.log("  token:", parsed.args.token);
                console.log("  account:", parsed.args.account);
                console.log("  amount:", parsed.args.amount.toString());
                console.log("  fee:", parsed.args.fee.toString());
                console.log("  serialNo:", parsed.args.serialNo);
                console.log("  txType:", parsed.args.txType);
            }
        } catch {}
    }

    // Make another payment with ETH (native token)
    console.log("\n=== Making ETH payment ===");
    const ethSerialNo = "ETH_PAY_" + Date.now();
    const ethAmount = ethers.parseEther("0.5");
    
    const ethPayment = {
        token: ethers.ZeroAddress,
        amount: ethAmount,
        serialNo: ethSerialNo,
        deadline: deadline
    };
    
    const ethSignature = await signPayment(projectSigner, projectAddress, projectId, ethPayment);
    
    const ethPayTx = await project.connect(user).pay(
        ethPayment,
        ethSignature,
        { value: ethAmount }
    );
    const ethPayReceipt = await ethPayTx.wait();
    console.log("ETH Payment tx hash:", ethPayReceipt.hash);
    console.log("ETH Payment tx block:", ethPayReceipt.blockNumber);

    for (const log of ethPayReceipt.logs) {
        try {
            const parsed = project.interface.parseLog(log);
            if (parsed && parsed.name === "PayTheFlyTransaction") {
                console.log("\n=== PayTheFlyTransaction Event (ETH) ===");
                console.log("  Contract (log.address):", log.address);
                console.log("  projectId:", parsed.args.projectId);
                console.log("  token:", parsed.args.token);
                console.log("  account:", parsed.args.account);
                console.log("  amount:", parsed.args.amount.toString());
                console.log("  fee:", parsed.args.fee.toString());
                console.log("  serialNo:", parsed.args.serialNo);
                console.log("  txType:", parsed.args.txType);
            }
        } catch {}
    }

    console.log("\n=== Done! ===");
    console.log("Factory:", await factory.getAddress());
    console.log("Project:", projectAddress);
    console.log("Token:", await token.getAddress());
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

/**
 * Test deployment script using Hardhat's built-in network
 *
 * Usage:
 *   npx hardhat run scripts/deploy/testDeploy.js
 */

const { ethers, upgrades } = require("hardhat");

async function main() {
    const [deployer, admin, signer, feeVault, user] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("========================================");
    console.log("PayTheFlyPro Test Deployment");
    console.log("========================================");
    console.log("Network:", network.name, `(chainId: ${network.chainId})`);
    console.log("Deployer:", deployer.address);
    console.log("========================================\n");

    const FEE_RATE = 100; // 1%

    // Step 1: Deploy PayTheFlyPro implementation
    console.log("Step 1: Deploying PayTheFlyPro implementation...");
    const PayTheFlyPro = await ethers.getContractFactory("PayTheFlyPro");
    const payTheFlyProImpl = await PayTheFlyPro.deploy();
    await payTheFlyProImpl.waitForDeployment();
    const implAddress = await payTheFlyProImpl.getAddress();
    console.log("  Implementation:", implAddress);

    // Step 2: Deploy PayTheFlyProFactory with UUPS proxy
    console.log("\nStep 2: Deploying PayTheFlyProFactory (UUPS Proxy)...");
    const PayTheFlyProFactory = await ethers.getContractFactory("PayTheFlyProFactory");
    const factory = await upgrades.deployProxy(
        PayTheFlyProFactory,
        [implAddress, feeVault.address, FEE_RATE],
        { kind: "uups" }
    );
    await factory.waitForDeployment();
    const factoryAddress = await factory.getAddress();
    console.log("  Factory Proxy:", factoryAddress);

    const factoryImplAddress = await upgrades.erc1967.getImplementationAddress(factoryAddress);
    console.log("  Factory Implementation:", factoryImplAddress);

    const beaconAddress = await factory.beacon();
    console.log("  Beacon:", beaconAddress);

    // Step 3: Create a test project
    console.log("\nStep 3: Creating test project...");
    const projectId = "test-project-001";
    const tx = await factory.createProject(
        projectId,
        "Test Project",
        admin.address,
        signer.address
    );
    await tx.wait();
    const projectAddress = await factory.getProject(projectId);
    console.log("  Project Address:", projectAddress);

    // Step 4: Verify project
    console.log("\nStep 4: Verifying project...");
    const project = await ethers.getContractAt("PayTheFlyPro", projectAddress);
    const info = await project.getProjectInfo();
    console.log("  Project ID:", info.projectId);
    console.log("  Name:", info.name);
    console.log("  Creator:", info.creator);
    console.log("  Signer:", info.signer);
    console.log("  Admins:", info.admins);
    console.log("  Threshold:", info.threshold.toString());

    // Step 5: Test payment
    console.log("\nStep 5: Testing payment...");
    const amount = ethers.parseEther("1.0");
    const serialNo = "TEST-PAY-001";
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const domain = {
        name: "PayTheFlyPro",
        version: "1",
        chainId: network.chainId,
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
        projectId: projectId,
        token: ethers.ZeroAddress,
        amount: amount,
        serialNo: serialNo,
        deadline: deadline
    };

    const signature = await signer.signTypedData(domain, types, value);

    const feeVaultBalanceBefore = await ethers.provider.getBalance(feeVault.address);
    await project.connect(user).pay(
        { token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
        signature,
        { value: amount }
    );
    const feeVaultBalanceAfter = await ethers.provider.getBalance(feeVault.address);

    const balance = await project.getBalance(ethers.ZeroAddress);
    console.log("  Payment received:", ethers.formatEther(balance.paymentBalance), "ETH");
    console.log("  Fee collected:", ethers.formatEther(feeVaultBalanceAfter - feeVaultBalanceBefore), "ETH");

    // Summary
    console.log("\n========================================");
    console.log("Test Deployment Summary");
    console.log("========================================");
    console.log("PayTheFlyPro Implementation:", implAddress);
    console.log("PayTheFlyProFactory Proxy:", factoryAddress);
    console.log("PayTheFlyProFactory Impl:", factoryImplAddress);
    console.log("UpgradeableBeacon:", beaconAddress);
    console.log("Test Project:", projectAddress);
    console.log("");
    console.log("All tests passed!");
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

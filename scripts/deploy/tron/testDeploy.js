/**
 * Test deployment script for TRON (TVM)
 *
 * Usage:
 *   npx hardhat run scripts/deploy/tron/testDeploy.js --network tronLocal
 *   npx hardhat run scripts/deploy/tron/testDeploy.js --network tronShasta
 */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { createTronEthersAdapter } = require("../../lib/TronEthersAdapter");
const { TronWeb } = require("tronweb");

async function main() {
    const networkName = hre.network.name;
    const networkConfig = hre.config.networks[networkName];
    const isTron = networkConfig && networkConfig.tron === true;

    if (!isTron) {
        throw new Error(`Network ${networkName} is not a TRON network. Use --network tronLocal or tronShasta`);
    }

    console.log("========================================");
    console.log("PayTheFlyPro Test Deployment (TRON)");
    console.log("========================================");
    console.log("Network:", networkName);

    // Setup TronWeb adapter
    let privateKey = networkConfig.accounts[0];
    if (privateKey && privateKey.startsWith("0x")) {
        privateKey = privateKey.slice(2);
    }

    const adapter = createTronEthersAdapter({
        fullHost: networkConfig.tpiUrl,
        privateKey: privateKey
    });

    const tronWeb = adapter.tronWeb;
    const deployerAddress = await adapter.signer.getAddress();
    const balance = await tronWeb.trx.getBalance(tronWeb.defaultAddress.hex);

    console.log("Deployer:", deployerAddress);
    console.log("Balance:", balance / 1000000, "TRX");
    console.log("========================================\n");

    const FEE_RATE = 100; // 1%
    const FEE_LIMIT = 1000000000; // 1000 TRX max for local TRE

    // Load artifacts (prefer TRON artifacts, fallback to EVM)
    let artifactsPath = path.join(__dirname, "../../../artifacts-tron/contracts");
    if (!fs.existsSync(artifactsPath)) {
        artifactsPath = path.join(__dirname, "../../../artifacts/contracts");
        console.log("Using standard EVM artifacts (TVM compatible)");
    }

    const payTheFlyProArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyPro.sol/PayTheFlyPro.json"))
    );
    const factoryArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyProFactory.sol/PayTheFlyProFactory.json"))
    );

    // Load ERC1967Proxy from OpenZeppelin (prefer TRON artifacts, fallback to EVM)
    let proxyArtifactPath = path.join(__dirname, "../../../artifacts-tron/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json");
    if (!fs.existsSync(proxyArtifactPath)) {
        proxyArtifactPath = path.join(__dirname, "../../../artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json");
    }
    const proxyArtifact = JSON.parse(fs.readFileSync(proxyArtifactPath));

    // Step 1: Deploy PayTheFlyPro implementation
    console.log("Step 1: Deploying PayTheFlyPro implementation...");
    const implContract = await tronWeb.contract().new({
        abi: payTheFlyProArtifact.abi,
        bytecode: payTheFlyProArtifact.bytecode,
        feeLimit: FEE_LIMIT,
        callValue: 0,
        parameters: []
    });
    const implAddressHex = implContract.address;
    const implAddress = TronWeb.address.fromHex(implAddressHex);
    console.log("  Implementation:", implAddress);

    // Step 2: Deploy PayTheFlyProFactory implementation
    console.log("\nStep 2: Deploying PayTheFlyProFactory implementation...");
    const factoryImplContract = await tronWeb.contract().new({
        abi: factoryArtifact.abi,
        bytecode: factoryArtifact.bytecode,
        feeLimit: FEE_LIMIT,
        callValue: 0,
        parameters: []
    });
    const factoryImplAddressHex = factoryImplContract.address;
    const factoryImplAddress = TronWeb.address.fromHex(factoryImplAddressHex);
    console.log("  Factory Implementation:", factoryImplAddress);

    // Step 3: Deploy Proxy with initialization data
    console.log("\nStep 3: Deploying UUPS Proxy for Factory...");

    // Encode initialize function call
    const feeVaultHex = tronWeb.defaultAddress.hex;
    const initInterface = new hre.ethers.Interface(factoryArtifact.abi);
    const initData = initInterface.encodeFunctionData("initialize", [
        implAddressHex.replace(/^41/, "0x"), // Convert TRON hex to EVM format
        feeVaultHex.replace(/^41/, "0x"),
        FEE_RATE
    ]);

    console.log("  Init data:", initData.slice(0, 66) + "...");

    const proxyContract = await tronWeb.contract().new({
        abi: proxyArtifact.abi,
        bytecode: proxyArtifact.bytecode,
        feeLimit: FEE_LIMIT,
        callValue: 0,
        parameters: [factoryImplAddressHex, initData]
    });
    const proxyAddressHex = proxyContract.address;
    const proxyAddress = TronWeb.address.fromHex(proxyAddressHex);
    console.log("  Factory Proxy:", proxyAddress);

    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 4: Verify initialization
    console.log("\nStep 4: Verifying initialization...");
    const factory = await tronWeb.contract(factoryArtifact.abi, proxyAddressHex);

    const owner = await factory.owner().call();
    const storedFeeVault = await factory.feeVault().call();
    const feeRate = await factory.feeRate().call();
    const beaconAddressHex = await factory.beacon().call();

    console.log("  Owner:", TronWeb.address.fromHex(owner));
    console.log("  Fee Vault:", TronWeb.address.fromHex(storedFeeVault));
    console.log("  Fee Rate:", feeRate.toString(), "basis points");
    console.log("  Beacon:", TronWeb.address.fromHex(beaconAddressHex));

    // Check if initialization succeeded
    if (owner === "410000000000000000000000000000000000000000") {
        throw new Error("Initialization failed - owner is zero address");
    }

    // Step 5: Create test project
    console.log("\nStep 5: Creating test project...");
    const projectId = "tron-test-" + Date.now();
    const signerHex = tronWeb.defaultAddress.hex;
    const adminHex = tronWeb.defaultAddress.hex;

    const createTx = await factory.createProject(
        projectId,
        "TRON Test Project",
        adminHex,
        signerHex
    ).send({
        feeLimit: FEE_LIMIT
    });
    console.log("  Create TX:", createTx);

    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 3000));

    const projectAddressHex = await factory.getProject(projectId).call();
    const projectAddress = TronWeb.address.fromHex(projectAddressHex);
    console.log("  Project Address:", projectAddress);

    // Step 6: Verify project
    console.log("\nStep 6: Verifying project...");
    const project = await tronWeb.contract(payTheFlyProArtifact.abi, projectAddressHex);
    const info = await project.getProjectInfo().call();

    console.log("  Project ID:", info.projectId);
    console.log("  Name:", info.name);
    console.log("  Creator:", TronWeb.address.fromHex(info.creator));
    console.log("  Signer:", TronWeb.address.fromHex(info.signer));
    console.log("  Paused:", info.paused);
    console.log("  Threshold:", info.threshold.toString());

    // Summary
    console.log("\n========================================");
    console.log("Test Deployment Summary (TRON)");
    console.log("========================================");
    console.log("PayTheFlyPro Implementation:", implAddress);
    console.log("PayTheFlyProFactory Impl:", factoryImplAddress);
    console.log("PayTheFlyProFactory Proxy:", proxyAddress);
    console.log("Beacon:", TronWeb.address.fromHex(beaconAddressHex));
    console.log("Test Project:", projectAddress);
    console.log("");
    console.log("All tests passed!");
    console.log("========================================");

    // Save deployment info
    const deploymentInfo = {
        network: networkName,
        deployer: deployerAddress,
        timestamp: new Date().toISOString(),
        contracts: {
            payTheFlyProImpl: implAddress,
            factoryImpl: factoryImplAddress,
            factoryProxy: proxyAddress,
            beacon: TronWeb.address.fromHex(beaconAddressHex),
            testProject: projectAddress
        },
        config: {
            feeVault: TronWeb.address.fromHex(feeVaultHex),
            feeRate: FEE_RATE
        }
    };

    const outputDir = path.join(__dirname, "../../../deployments", networkName);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, "PayTheFlyProFactory.json");
    fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`\nDeployment info saved to: ${outputPath}`);

    return deploymentInfo;
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });

/**
 * Create a new project on TRON using PayTheFlyProFactory
 *
 * Usage:
 *   TRON_PRIVATE_KEY=xxx TRON_NETWORK=shasta FACTORY=Txxx PROJECT_ID=myproject \
 *     PROJECT_NAME="My Project" ADMIN=Txxx SIGNER=Txxx node scripts/deploy/tron/createProject.js
 */

const { TronWeb } = require("tronweb");
const fs = require("fs");
const path = require("path");

// Network configurations
const NETWORKS = {
    local: {
        fullHost: "http://127.0.0.1:9090",
        name: "Local TRE"
    },
    shasta: {
        fullHost: "https://api.shasta.trongrid.io",
        name: "Shasta Testnet"
    },
    nile: {
        fullHost: "https://nile.trongrid.io",
        name: "Nile Testnet"
    },
    mainnet: {
        fullHost: "https://api.trongrid.io",
        name: "TRON Mainnet"
    }
};

async function main() {
    // Configuration
    const privateKey = process.env.TRON_PRIVATE_KEY;
    const networkName = process.env.TRON_NETWORK || "shasta";
    const factoryAddress = process.env.FACTORY;
    const projectId = process.env.PROJECT_ID;
    const projectName = process.env.PROJECT_NAME || projectId;
    const adminAddress = process.env.ADMIN;
    const signerAddress = process.env.SIGNER;

    if (!privateKey) {
        throw new Error("TRON_PRIVATE_KEY environment variable is required");
    }
    if (!factoryAddress) {
        throw new Error("FACTORY environment variable is required");
    }
    if (!projectId) {
        throw new Error("PROJECT_ID environment variable is required");
    }

    const networkConfig = NETWORKS[networkName];
    if (!networkConfig) {
        throw new Error(`Unknown network: ${networkName}`);
    }

    // Initialize TronWeb
    const tronWeb = new TronWeb({
        fullHost: networkConfig.fullHost,
        privateKey: privateKey
    });

    const deployerAddress = tronWeb.address.fromPrivateKey(privateKey);
    const admin = adminAddress || deployerAddress;
    const signer = signerAddress || deployerAddress;

    console.log("========================================");
    console.log("Create New Project (TRON)");
    console.log("========================================");
    console.log("Network:", networkConfig.name);
    console.log("Creator:", deployerAddress);
    console.log("========================================\n");

    console.log("Configuration:");
    console.log("  Factory:", factoryAddress);
    console.log("  Project ID:", projectId);
    console.log("  Project Name:", projectName);
    console.log("  Admin:", admin);
    console.log("  Signer:", signer);
    console.log("");

    // Load factory ABI
    const artifactsPath = path.join(__dirname, "../../../artifacts/contracts");
    const factoryArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyProFactory.sol/PayTheFlyProFactory.json"))
    );
    const projectArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyPro.sol/PayTheFlyPro.json"))
    );

    // Get factory contract
    const factory = await tronWeb.contract(factoryArtifact.abi, factoryAddress);

    // Check if project exists
    const existingProject = await factory.getProject(projectId).call();
    if (existingProject !== "410000000000000000000000000000000000000000") {
        console.log("Project already exists at:", tronWeb.address.fromHex(existingProject));
        return;
    }

    // Create project
    console.log("Creating project...");
    const tx = await factory.createProject(
        projectId,
        projectName,
        tronWeb.address.toHex(admin),
        tronWeb.address.toHex(signer)
    ).send({
        feeLimit: 1000000000 // 1000 TRX
    });
    console.log("Transaction hash:", tx);

    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get project address
    const projectAddress = await factory.getProject(projectId).call();
    const projectAddressBase58 = tronWeb.address.fromHex(projectAddress);
    console.log("\nProject created successfully!");
    console.log("Project Address:", projectAddressBase58);

    // Verify project info
    const project = await tronWeb.contract(projectArtifact.abi, projectAddress);
    const info = await project.getProjectInfo().call();

    console.log("\nProject Info:");
    console.log("  Project ID:", info.projectId);
    console.log("  Name:", info.name);
    console.log("  Creator:", tronWeb.address.fromHex(info.creator));
    console.log("  Signer:", tronWeb.address.fromHex(info.signer));
    console.log("  Paused:", info.paused);
    console.log("  Threshold:", info.threshold.toString());

    // Summary
    console.log("\n========================================");
    console.log("Project Deployment Summary (TRON)");
    console.log("========================================");
    console.log("Project ID:", projectId);
    console.log("Project Address:", projectAddressBase58);
    console.log("Admin:", admin);
    console.log("Signer:", signer);
    console.log("========================================");

    return {
        projectId,
        projectAddress: projectAddressBase58,
        admin,
        signer
    };
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error:", error);
        process.exit(1);
    });

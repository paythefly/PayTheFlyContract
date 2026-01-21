/**
 * Create a new project on TRON using PayTheFlyProFactory
 *
 * Usage:
 *   npx hardhat run scripts/deploy/tron/createProject.js --network tronLocal
 *
 * Environment Variables:
 *   FACTORY - Factory address (or reads from deployment-local.json)
 *   PROJECT_ID - Project ID (required)
 *   PROJECT_NAME - Project name (optional, defaults to PROJECT_ID)
 *   ADMIN - Admin address (optional, defaults to deployer)
 *   SIGNER - Signer address (optional, defaults to deployer)
 */

const { TronWeb } = require("tronweb");
const fs = require("fs");
const path = require("path");

// Try to load hardhat vars (but not hardhat runtime)
let hardhatVars;
try {
    const { vars } = require("hardhat/config");
    hardhatVars = vars;
} catch (e) {}

const NETWORKS = {
    tronLocal: { fullHost: "http://127.0.0.1:9090", name: "Local TRE", keyName: "TRE_LOCAL_TRON_DEVELOPMENT_KEY_1" },
    local: { fullHost: "http://127.0.0.1:9090", name: "Local TRE", keyName: "TRE_LOCAL_TRON_DEVELOPMENT_KEY_1" },
    tronShasta: { fullHost: "https://api.shasta.trongrid.io", name: "Shasta Testnet", keyName: "TRON_DEVELOPMENT_KEY" },
    shasta: { fullHost: "https://api.shasta.trongrid.io", name: "Shasta Testnet", keyName: "TRON_DEVELOPMENT_KEY" },
    tronNile: { fullHost: "https://nile.trongrid.io", name: "Nile Testnet", keyName: "TRON_DEVELOPMENT_KEY" },
    nile: { fullHost: "https://nile.trongrid.io", name: "Nile Testnet", keyName: "TRON_DEVELOPMENT_KEY" },
    tronMainnet: { fullHost: "https://api.trongrid.io", name: "TRON Mainnet", keyName: "TRON_DEVELOPMENT_KEY" },
    mainnet: { fullHost: "https://api.trongrid.io", name: "TRON Mainnet", keyName: "TRON_DEVELOPMENT_KEY" }
};

function getPrivateKey(networkConfig) {
    if (process.env.TRON_PRIVATE_KEY) return process.env.TRON_PRIVATE_KEY;
    if (hardhatVars) {
        try { return hardhatVars.get(networkConfig.keyName); } catch (e) {}
    }
    throw new Error(`Private key not found. Set TRON_PRIVATE_KEY or hardhat var ${networkConfig.keyName}`);
}

async function main() {
    // Determine network from env
    const networkName = process.env.TRON_NETWORK || "local";

    const networkConfig = NETWORKS[networkName];
    if (!networkConfig) throw new Error(`Unknown network: ${networkName}`);

    const privateKey = getPrivateKey(networkConfig);

    // Load factory from deployment file if not provided
    let factoryAddress = process.env.FACTORY;
    if (!factoryAddress) {
        const deployFile = path.join(__dirname, `deployment-${networkName.replace('tron', '').toLowerCase() || 'local'}.json`);
        if (fs.existsSync(deployFile)) {
            const data = JSON.parse(fs.readFileSync(deployFile));
            factoryAddress = data.contracts.factoryProxy;
        }
    }

    const projectId = process.env.PROJECT_ID;
    const projectName = process.env.PROJECT_NAME || projectId;
    const adminAddress = process.env.ADMIN;
    const signerAddress = process.env.SIGNER;

    if (!factoryAddress) {
        throw new Error("FACTORY environment variable required or deploy factory first");
    }
    if (!projectId) {
        throw new Error("PROJECT_ID environment variable is required");
    }

    // Initialize TronWeb
    const tronWeb = new TronWeb({
        fullHost: networkConfig.fullHost,
        privateKey: privateKey
    });

    // Patch for TRE compatibility (TRE doesn't support /wallet/getblock)
    if (networkName === "local" || networkName === "tronLocal") {
        tronWeb.trx.getCurrentRefBlockParams = async function() {
            const block = await tronWeb.fullNode.request('wallet/getnowblock', {}, 'post');
            const { number, timestamp } = block.block_header.raw_data;
            return {
                ref_block_bytes: number.toString(16).slice(-4).padStart(4, '0'),
                ref_block_hash: block.blockID.slice(16, 32),
                expiration: timestamp + 60 * 1000,
                timestamp,
            };
        };
        console.log("Applied TRE compatibility patch\n");
    }

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

    // Verify project info with retry
    let info;
    for (let i = 0; i < 5; i++) {
        try {
            const project = await tronWeb.contract(projectArtifact.abi, projectAddress);
            info = await project.getProjectInfo().call();
            break;
        } catch (e) {
            if (i < 4) {
                console.log(`  Verification attempt ${i + 1} failed, retrying in 5s...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                console.log("  Warning: Could not verify project. Contract may still be confirming.");
            }
        }
    }

    if (info) {
        console.log("\nProject Info:");
        console.log("  Project ID:", info.projectId);
        console.log("  Name:", info.name);
        console.log("  Creator:", tronWeb.address.fromHex(info.creator));
        console.log("  Signer:", tronWeb.address.fromHex(info.signer));
        console.log("  Paused:", info.paused);
        console.log("  Threshold:", info.threshold.toString());
    }

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

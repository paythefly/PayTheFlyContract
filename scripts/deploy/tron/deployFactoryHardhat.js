/**
 * Deploy PayTheFlyProFactory on TRON using Hardhat
 *
 * Usage:
 *   npx hardhat run scripts/deploy/tron/deployFactoryHardhat.js
 *
 * Environment Variables (optional, will override hardhat vars):
 *   TRON_NETWORK - Network name (local, shasta, nile, mainnet)
 *   FEE_VAULT - Fee vault address (TRON format)
 *   FEE_RATE - Fee rate in basis points (default: 100 = 1%)
 *
 * Hardhat Vars (set via: npx hardhat vars set KEY):
 *   TRON_DEVELOPMENT_KEY - Private key for deployment
 *   TRE_LOCAL_TRON_DEVELOPMENT_KEY_1 - Local TRE private key
 */

const { TronWeb } = require("tronweb");
const { vars } = require("hardhat/config");
const fs = require("fs");
const path = require("path");

// Network configurations
const NETWORKS = {
    local: {
        fullHost: "http://127.0.0.1:9090",
        name: "Local TRE",
        keyName: "TRE_LOCAL_TRON_DEVELOPMENT_KEY_1"
    },
    shasta: {
        fullHost: "https://api.shasta.trongrid.io",
        name: "Shasta Testnet",
        keyName: "TRON_DEVELOPMENT_KEY"
    },
    nile: {
        fullHost: "https://nile.trongrid.io",
        name: "Nile Testnet",
        keyName: "TRON_DEVELOPMENT_KEY"
    },
    mainnet: {
        fullHost: "https://api.trongrid.io",
        name: "TRON Mainnet",
        keyName: "TRON_DEVELOPMENT_KEY"
    }
};

// Default configuration
const DEFAULT_CONFIG = {
    network: "local",
    feeVault: "TVtiRNnzbrET6FndHBCLDxRBNid9LHMNjH",
    feeRate: 100 // 1%
};

async function main() {
    // Get configuration from env or defaults
    const networkName = process.env.TRON_NETWORK || DEFAULT_CONFIG.network;
    const feeVault = process.env.FEE_VAULT || DEFAULT_CONFIG.feeVault;
    const feeRate = parseInt(process.env.FEE_RATE || DEFAULT_CONFIG.feeRate);

    const networkConfig = NETWORKS[networkName];
    if (!networkConfig) {
        throw new Error(`Unknown network: ${networkName}. Use: local, shasta, nile, or mainnet`);
    }

    // Get private key from hardhat vars
    let privateKey;
    try {
        privateKey = vars.get(networkConfig.keyName);
    } catch (e) {
        // Fallback to env variable
        privateKey = process.env.TRON_PRIVATE_KEY;
    }

    if (!privateKey) {
        throw new Error(`Private key not found. Set via: npx hardhat vars set ${networkConfig.keyName}`);
    }

    // Initialize TronWeb
    const tronWeb = new TronWeb({
        fullHost: networkConfig.fullHost,
        privateKey: privateKey
    });

    const deployerAddress = tronWeb.address.fromPrivateKey(privateKey);
    const balance = await tronWeb.trx.getBalance(deployerAddress);

    console.log("========================================");
    console.log("PayTheFlyPro Factory Deployment (TRON)");
    console.log("========================================");
    console.log("Network:", networkConfig.name);
    console.log("Deployer:", deployerAddress);
    console.log("Balance:", tronWeb.fromSun(balance), "TRX");
    console.log("========================================\n");

    console.log("Configuration:");
    console.log("  Fee Vault:", feeVault);
    console.log("  Fee Rate:", feeRate, "basis points (", feeRate / 100, "%)");
    console.log("");

    // Load compiled contracts from artifacts
    const artifactsPath = path.join(__dirname, "../../../artifacts/contracts");

    const payTheFlyProArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyPro.sol/PayTheFlyPro.json"))
    );
    const factoryArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyProFactory.sol/PayTheFlyProFactory.json"))
    );

    // Step 1: Deploy PayTheFlyPro implementation
    console.log("Step 1: Deploying PayTheFlyPro implementation...");
    const payTheFlyProContract = await tronWeb.contract().new({
        abi: payTheFlyProArtifact.abi,
        bytecode: payTheFlyProArtifact.bytecode,
        feeLimit: 1000000000,
        callValue: 0,
        parameters: []
    });
    const implAddress = tronWeb.address.fromHex(payTheFlyProContract.address);
    console.log("  PayTheFlyPro Implementation:", implAddress);

    // Step 2: Deploy PayTheFlyProFactory
    console.log("\nStep 2: Deploying PayTheFlyProFactory...");
    const factoryContract = await tronWeb.contract().new({
        abi: factoryArtifact.abi,
        bytecode: factoryArtifact.bytecode,
        feeLimit: 1000000000,
        callValue: 0,
        parameters: []
    });
    const factoryAddress = tronWeb.address.fromHex(factoryContract.address);
    console.log("  Factory Address:", factoryAddress);

    // Step 3: Initialize the factory
    console.log("\nStep 3: Initializing factory...");
    const factory = await tronWeb.contract(factoryArtifact.abi, factoryContract.address);

    const initTx = await factory.initialize(
        tronWeb.address.toHex(implAddress),
        tronWeb.address.toHex(feeVault),
        feeRate
    ).send({
        feeLimit: 500000000
    });
    console.log("  Initialize TX:", initTx);

    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 4: Verify deployment
    console.log("\nStep 4: Verifying deployment...");
    const owner = await factory.owner().call();
    const storedFeeVault = await factory.feeVault().call();
    const storedFeeRate = await factory.feeRate().call();
    const beaconAddress = await factory.beacon().call();

    console.log("  Owner:", tronWeb.address.fromHex(owner));
    console.log("  Fee Vault:", tronWeb.address.fromHex(storedFeeVault));
    console.log("  Fee Rate:", storedFeeRate.toString());
    console.log("  Beacon:", tronWeb.address.fromHex(beaconAddress));

    // Summary
    console.log("\n========================================");
    console.log("Deployment Summary (TRON)");
    console.log("========================================");
    console.log("PayTheFlyPro Implementation:", implAddress);
    console.log("PayTheFlyProFactory:", factoryAddress);
    console.log("Beacon:", tronWeb.address.fromHex(beaconAddress));
    console.log("========================================");

    // Save deployment info
    const deploymentInfo = {
        network: networkName,
        networkName: networkConfig.name,
        deployer: deployerAddress,
        timestamp: new Date().toISOString(),
        contracts: {
            payTheFlyProImpl: implAddress,
            factory: factoryAddress,
            beacon: tronWeb.address.fromHex(beaconAddress)
        },
        config: {
            feeVault: feeVault,
            feeRate: feeRate
        }
    };

    // Save to file
    const outputPath = path.join(__dirname, `deployment-${networkName}.json`);
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

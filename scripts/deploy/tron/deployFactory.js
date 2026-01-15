/**
 * Deploy PayTheFlyProFactory on TRON (TVM)
 *
 * Prerequisites:
 *   npm install tronweb
 *
 * Usage:
 *   TRON_PRIVATE_KEY=xxx TRON_NETWORK=shasta node scripts/deploy/tron/deployFactory.js
 *   TRON_PRIVATE_KEY=xxx TRON_NETWORK=nile node scripts/deploy/tron/deployFactory.js
 *   TRON_PRIVATE_KEY=xxx TRON_NETWORK=mainnet node scripts/deploy/tron/deployFactory.js
 *
 * Environment Variables:
 *   TRON_PRIVATE_KEY - Private key for deployment
 *   TRON_NETWORK - Network name (shasta, nile, mainnet)
 *   FEE_VAULT - Fee vault address (TRON format)
 *   FEE_RATE - Fee rate in basis points (default: 100 = 1%)
 */

const { TronWeb } = require("tronweb");
const fs = require("fs");
const path = require("path");

// Network configurations
const NETWORKS = {
    local: {
        fullHost: "http://127.0.0.1:9090",
        solidityNode: "http://127.0.0.1:9090",
        eventServer: "http://127.0.0.1:9090",
        name: "Local TRE"
    },
    shasta: {
        fullHost: "https://api.shasta.trongrid.io",
        solidityNode: "https://api.shasta.trongrid.io",
        eventServer: "https://api.shasta.trongrid.io",
        name: "Shasta Testnet"
    },
    nile: {
        fullHost: "https://nile.trongrid.io",
        solidityNode: "https://nile.trongrid.io",
        eventServer: "https://nile.trongrid.io",
        name: "Nile Testnet"
    },
    mainnet: {
        fullHost: "https://api.trongrid.io",
        solidityNode: "https://api.trongrid.io",
        eventServer: "https://api.trongrid.io",
        name: "TRON Mainnet"
    }
};

async function main() {
    // Configuration
    const privateKey = process.env.TRON_PRIVATE_KEY;
    const networkName = process.env.TRON_NETWORK || "shasta";
    const feeVault = process.env.FEE_VAULT;
    const feeRate = parseInt(process.env.FEE_RATE || "100");

    if (!privateKey) {
        throw new Error("TRON_PRIVATE_KEY environment variable is required");
    }
    if (!feeVault) {
        throw new Error("FEE_VAULT environment variable is required");
    }

    const networkConfig = NETWORKS[networkName];
    if (!networkConfig) {
        throw new Error(`Unknown network: ${networkName}. Use: shasta, nile, or mainnet`);
    }

    // Initialize TronWeb
    const tronWeb = new TronWeb({
        fullHost: networkConfig.fullHost,
        solidityNode: networkConfig.solidityNode,
        eventServer: networkConfig.eventServer,
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

    // Load compiled contracts
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
        feeLimit: 1000000000, // 1000 TRX
        callValue: 0,
        parameters: []
    });
    const implAddress = tronWeb.address.fromHex(payTheFlyProContract.address);
    console.log("  PayTheFlyPro Implementation:", implAddress);

    // Step 2: Deploy PayTheFlyProFactory
    // Note: On TRON, we deploy directly without proxy for simplicity
    // For production, consider using a custom proxy pattern
    console.log("\nStep 2: Deploying PayTheFlyProFactory...");

    // Convert fee vault to hex format
    const feeVaultHex = tronWeb.address.toHex(feeVault).replace(/^41/, "0x");

    const factoryContract = await tronWeb.contract().new({
        abi: factoryArtifact.abi,
        bytecode: factoryArtifact.bytecode,
        feeLimit: 2000000000, // 2000 TRX
        callValue: 0,
        parameters: []
    });
    const factoryAddress = tronWeb.address.fromHex(factoryContract.address);
    console.log("  Factory Address:", factoryAddress);

    // Step 3: Initialize the factory
    console.log("\nStep 3: Initializing factory...");

    // Get the deployed factory instance
    const factory = await tronWeb.contract(factoryArtifact.abi, factoryContract.address);

    // Initialize with implementation, feeVault, and feeRate
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

    console.log("\nDeployment Info (JSON):");
    console.log(JSON.stringify(deploymentInfo, null, 2));

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

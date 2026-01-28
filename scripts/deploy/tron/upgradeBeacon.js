/**
 * Upgrade PayTheFlyPro implementation via Beacon on TRON
 *
 * Usage:
 *   TRON_PRIVATE_KEY=xxx TRON_NETWORK=nile FACTORY=TJnbELzQWH7DL7X9qJ3GYctgaPvYSH9wkj node scripts/deploy/tron/upgradeBeacon.js
 *
 * Environment Variables:
 *   TRON_PRIVATE_KEY - Private key for deployment
 *   TRON_NETWORK - Network name (local, shasta, nile, mainnet)
 *   FACTORY - Factory proxy address (TRON format)
 */

const { TronWeb } = require("tronweb");
const fs = require("fs");
const path = require("path");

// Try to load hardhat vars
let hardhatVars = null;
try {
    const { vars } = require("hardhat/config");
    hardhatVars = vars;
} catch (e) {
    // Running without hardhat
}

// Network configurations
const NETWORKS = {
    local: {
        fullHost: "http://127.0.0.1:9090",
        solidityNode: "http://127.0.0.1:9090",
        eventServer: "http://127.0.0.1:9090",
        name: "Local TRE",
        keyName: "TRE_LOCAL_TRON_DEVELOPMENT_KEY_1"
    },
    shasta: {
        fullHost: "https://api.shasta.trongrid.io",
        solidityNode: "https://api.shasta.trongrid.io",
        eventServer: "https://api.shasta.trongrid.io",
        name: "Shasta Testnet",
        keyName: "TRON_DEVELOPMENT_KEY"
    },
    nile: {
        fullHost: "https://nile.trongrid.io",
        solidityNode: "https://nile.trongrid.io",
        eventServer: "https://nile.trongrid.io",
        name: "Nile Testnet",
        keyName: "TRON_DEVELOPMENT_KEY"
    },
    mainnet: {
        fullHost: "https://api.trongrid.io",
        solidityNode: "https://api.trongrid.io",
        eventServer: "https://api.trongrid.io",
        name: "TRON Mainnet",
        keyName: "TRON_DEVELOPMENT_KEY"
    }
};

// Get private key from env or hardhat vars
function getPrivateKey(networkConfig) {
    if (process.env.TRON_PRIVATE_KEY) {
        return process.env.TRON_PRIVATE_KEY;
    }

    if (hardhatVars) {
        try {
            return hardhatVars.get(networkConfig.keyName);
        } catch (e) {
            // Key not found
        }
    }

    throw new Error(
        `Private key not found. Either:\n` +
        `  1. Set TRON_PRIVATE_KEY environment variable, or\n` +
        `  2. Set hardhat var: npx hardhat vars set ${networkConfig.keyName}`
    );
}

/**
 * Patch TronWeb for TRE compatibility
 */
function patchTronWebForTRE(tronWeb) {
    const originalGetCurrentRefBlockParams = tronWeb.trx.getCurrentRefBlockParams.bind(tronWeb.trx);

    tronWeb.trx.getCurrentRefBlockParams = async function() {
        try {
            const block = await tronWeb.fullNode.request('wallet/getnowblock', {}, 'post');
            const { number, timestamp } = block.block_header.raw_data;
            return {
                ref_block_bytes: number.toString(16).slice(-4).padStart(4, '0'),
                ref_block_hash: block.blockID.slice(16, 32),
                expiration: timestamp + 60 * 1000,
                timestamp,
            };
        } catch (e) {
            return originalGetCurrentRefBlockParams();
        }
    };

    return tronWeb;
}

/**
 * Deploy a contract manually
 */
async function deployContract(tronWeb, abi, bytecode, parameters = [], feeLimit = 1000000000) {
    const ownerAddress = tronWeb.defaultAddress.hex;

    let deployBytecode = bytecode;
    if (parameters.length > 0) {
        const constructorAbi = abi.find(item => item.type === 'constructor');
        if (constructorAbi && constructorAbi.inputs && constructorAbi.inputs.length > 0) {
            const types = constructorAbi.inputs.map(input => input.type);
            const encodedParams = tronWeb.utils.abi.encodeParams(types, parameters);
            deployBytecode = bytecode + encodedParams.slice(2);
        }
    }

    const tx = await tronWeb.transactionBuilder.createSmartContract({
        abi: [],
        bytecode: deployBytecode,
        feeLimit: feeLimit,
        callValue: 0,
        owner_address: ownerAddress
    });

    const signedTx = await tronWeb.trx.sign(tx);

    let result;
    for (let i = 0; i < 3; i++) {
        result = await tronWeb.trx.sendRawTransaction(signedTx);
        if (result.result === true) break;
        if (result.code === 'SERVER_BUSY') {
            console.log('    Server busy, retrying in 5s...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
            break;
        }
    }

    if (!result.result) {
        throw new Error(`Deployment failed: ${JSON.stringify(result)}`);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    const contractAddress = result.transaction.contract_address || signedTx.contract_address;

    return {
        address: contractAddress,
        txId: result.transaction.txID
    };
}

async function main() {
    const networkName = process.env.TRON_NETWORK || "nile";
    const factoryAddress = process.env.FACTORY;

    if (!factoryAddress) {
        throw new Error("FACTORY environment variable is required");
    }

    const networkConfig = NETWORKS[networkName];
    if (!networkConfig) {
        throw new Error(`Unknown network: ${networkName}. Use: local, shasta, nile, or mainnet`);
    }

    const privateKey = getPrivateKey(networkConfig);

    // Initialize TronWeb
    let tronWeb = new TronWeb({
        fullHost: networkConfig.fullHost,
        solidityNode: networkConfig.solidityNode,
        eventServer: networkConfig.eventServer,
        privateKey: privateKey
    });

    if (networkName === "local") {
        tronWeb = patchTronWebForTRE(tronWeb);
        console.log("Applied TRE compatibility patch for TronWeb v6\n");
    }

    const deployerAddress = tronWeb.address.fromPrivateKey(privateKey);
    const balance = await tronWeb.trx.getBalance(deployerAddress);

    console.log("========================================");
    console.log("Upgrade PayTheFlyPro via Beacon (TRON)");
    console.log("========================================");
    console.log("Network:", networkConfig.name);
    console.log("Upgrader:", deployerAddress);
    console.log("Balance:", tronWeb.fromSun(balance), "TRX");
    console.log("Factory:", factoryAddress);
    console.log("========================================\n");

    // Load artifacts
    const baseDir = path.join(__dirname, "../../..");
    let artifactsPath = path.join(baseDir, "artifacts-tron/contracts");
    if (!fs.existsSync(artifactsPath)) {
        artifactsPath = path.join(baseDir, "artifacts/contracts");
        console.log("Warning: Using EVM artifacts.\n");
    }

    const payTheFlyProArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyPro.sol/PayTheFlyPro.json"))
    );
    const factoryArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyProFactory.sol/PayTheFlyProFactory.json"))
    );

    // Load UpgradeableBeacon ABI
    let beaconArtifactPath = path.join(baseDir, "artifacts-tron/@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol/UpgradeableBeacon.json");
    if (!fs.existsSync(beaconArtifactPath)) {
        beaconArtifactPath = path.join(baseDir, "artifacts/@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol/UpgradeableBeacon.json");
    }
    const beaconArtifact = JSON.parse(fs.readFileSync(beaconArtifactPath));

    // Get factory contract
    const factoryHex = tronWeb.address.toHex(factoryAddress);
    const factory = await tronWeb.contract(factoryArtifact.abi, factoryHex);

    // Check owner
    const ownerHex = await factory.owner().call();
    const owner = tronWeb.address.fromHex(ownerHex);
    console.log("Factory Owner:", owner);

    if (owner !== deployerAddress) {
        throw new Error(`Deployer ${deployerAddress} is not the owner ${owner}`);
    }

    // Get beacon address
    const beaconHex = await factory.beacon().call();
    const beaconAddress = tronWeb.address.fromHex(beaconHex);
    console.log("Beacon Address:", beaconAddress);

    // Get current implementation
    const beacon = await tronWeb.contract(beaconArtifact.abi, beaconHex);
    const currentImplHex = await beacon.implementation().call();
    const currentImpl = tronWeb.address.fromHex(currentImplHex);
    console.log("Current Implementation:", currentImpl);

    // Step 1: Deploy new implementation
    console.log("\nStep 1: Deploying new PayTheFlyPro implementation...");
    const newImplResult = await deployContract(
        tronWeb,
        payTheFlyProArtifact.abi,
        payTheFlyProArtifact.bytecode
    );
    const newImplAddress = tronWeb.address.fromHex(newImplResult.address);
    console.log("  New Implementation:", newImplAddress);
    console.log("  TX:", newImplResult.txId);

    // Wait for contract to be confirmed
    console.log("\n  Waiting for contract confirmation (15s)...");
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Step 2: Upgrade beacon via factory
    console.log("\nStep 2: Upgrading beacon...");
    const newImplHex = tronWeb.address.toHex(newImplAddress).replace(/^41/, "0x");

    const upgradeTx = await factory.upgradeBeacon(newImplHex).send({
        feeLimit: 100000000,
        callValue: 0
    });
    console.log("  Upgrade TX:", upgradeTx);

    // Wait for upgrade to be confirmed
    console.log("\n  Waiting for upgrade confirmation (10s)...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Verify upgrade
    console.log("\nStep 3: Verifying upgrade...");
    const updatedImplHex = await beacon.implementation().call();
    const updatedImpl = tronWeb.address.fromHex(updatedImplHex);
    console.log("  Updated Implementation:", updatedImpl);

    if (updatedImpl !== newImplAddress) {
        throw new Error(`Upgrade verification failed! Expected ${newImplAddress}, got ${updatedImpl}`);
    }

    console.log("\n========================================");
    console.log("Beacon Upgrade Complete");
    console.log("========================================");
    console.log("Old Implementation:", currentImpl);
    console.log("New Implementation:", newImplAddress);
    console.log("========================================");
    console.log("\nAll existing projects will now use the new implementation!");

    // Update deployment file
    const deploymentPath = path.join(__dirname, `deployment-${networkName}.json`);
    if (fs.existsSync(deploymentPath)) {
        const deployment = JSON.parse(fs.readFileSync(deploymentPath));
        deployment.contracts.payTheFlyProImpl = newImplAddress;
        deployment.upgrades = deployment.upgrades || [];
        deployment.upgrades.push({
            timestamp: new Date().toISOString(),
            oldImpl: currentImpl,
            newImpl: newImplAddress,
            txId: upgradeTx
        });
        fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
        console.log(`\nDeployment file updated: ${deploymentPath}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Upgrade failed:", error);
        process.exit(1);
    });

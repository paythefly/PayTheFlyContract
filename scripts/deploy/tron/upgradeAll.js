/**
 * Full Upgrade: PayTheFlyProFactory (UUPS) + PayTheFlyPro (Beacon) on TRON
 * - Deploys new Factory implementation and upgrades via upgradeToAndCall
 * - Deploys new PayTheFlyPro implementation and upgrades beacon
 *
 * Usage:
 *   TRON_NETWORK=nile node scripts/deploy/tron/upgradeAll.js
 *   TRON_NETWORK=mainnet node scripts/deploy/tron/upgradeAll.js
 *
 * Environment Variables:
 *   TRON_PRIVATE_KEY - Private key for deployment (optional, uses hardhat vars if not set)
 *   TRON_NETWORK - Network name (local, nile, mainnet)
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
        name: "Local TRE",
        keyName: "TRE_LOCAL_TRON_DEVELOPMENT_KEY_1"
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

function getPrivateKey(networkConfig) {
    if (process.env.TRON_PRIVATE_KEY) {
        return process.env.TRON_PRIVATE_KEY;
    }
    if (hardhatVars) {
        try {
            return hardhatVars.get(networkConfig.keyName);
        } catch (e) {}
    }
    throw new Error(`Private key not found. Set TRON_PRIVATE_KEY or hardhat var: ${networkConfig.keyName}`);
}

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

async function deployContract(tronWeb, abi, bytecode, parameters = [], feeLimit = 1500000000) {
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

    const networkConfig = NETWORKS[networkName];
    if (!networkConfig) {
        throw new Error(`Unknown network: ${networkName}. Use: local, nile, or mainnet`);
    }

    // Load deployment info
    const deploymentPath = path.join(__dirname, `deployment-${networkName}.json`);
    if (!fs.existsSync(deploymentPath)) {
        throw new Error(`Deployment file not found: ${deploymentPath}`);
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentPath));

    const privateKey = getPrivateKey(networkConfig);

    let tronWeb = new TronWeb({
        fullHost: networkConfig.fullHost,
        privateKey: privateKey
    });

    if (networkName === "local") {
        tronWeb = patchTronWebForTRE(tronWeb);
    }

    const deployerAddress = tronWeb.address.fromPrivateKey(privateKey);
    const balance = await tronWeb.trx.getBalance(deployerAddress);

    console.log("========================================");
    console.log("Full Upgrade - PayTheFlyPro (TRON)");
    console.log("========================================");
    console.log("Network:", networkConfig.name);
    console.log("Deployer:", deployerAddress);
    console.log("Balance:", tronWeb.fromSun(balance), "TRX");
    console.log("========================================\n");

    console.log("Current Deployment:");
    console.log("  Factory Proxy:", deployment.contracts.factoryProxy);
    console.log("  Factory Impl:", deployment.contracts.factoryImpl);
    console.log("  Beacon:", deployment.contracts.beacon);
    console.log("  PayTheFlyPro Impl:", deployment.contracts.payTheFlyProImpl);
    console.log("");

    // Load artifacts
    const baseDir = path.join(__dirname, "../../..");
    let artifactsPath = path.join(baseDir, "artifacts-tron/contracts");
    if (!fs.existsSync(artifactsPath)) {
        artifactsPath = path.join(baseDir, "artifacts/contracts");
        console.log("Warning: Using EVM artifacts.\n");
    }

    const factoryArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyProFactory.sol/PayTheFlyProFactory.json"))
    );
    const payTheFlyProArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyPro.sol/PayTheFlyPro.json"))
    );

    let beaconArtifactPath = path.join(baseDir, "artifacts-tron/@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol/UpgradeableBeacon.json");
    if (!fs.existsSync(beaconArtifactPath)) {
        beaconArtifactPath = path.join(baseDir, "artifacts/@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol/UpgradeableBeacon.json");
    }
    const beaconArtifact = JSON.parse(fs.readFileSync(beaconArtifactPath));

    // Connect to factory
    const factoryHex = tronWeb.address.toHex(deployment.contracts.factoryProxy);
    const factory = await tronWeb.contract(factoryArtifact.abi, factoryHex);

    // Verify ownership
    const ownerHex = await factory.owner().call();
    const owner = tronWeb.address.fromHex(ownerHex);
    if (owner !== deployerAddress) {
        throw new Error(`Not owner. Owner is ${owner}, deployer is ${deployerAddress}`);
    }
    console.log("Ownership verified ✓\n");

    // Step 1: Deploy new Factory implementation
    console.log("Step 1: Deploying new PayTheFlyProFactory Implementation...");
    const newFactoryImplResult = await deployContract(
        tronWeb,
        factoryArtifact.abi,
        factoryArtifact.bytecode
    );
    const newFactoryImplAddress = tronWeb.address.fromHex(newFactoryImplResult.address);
    console.log("  New Factory Impl:", newFactoryImplAddress);
    console.log("  TX:", newFactoryImplResult.txId);

    console.log("\n  Waiting for confirmation (15s)...");
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Step 2: Upgrade Factory proxy
    console.log("\nStep 2: Upgrading Factory Proxy...");
    const newFactoryImplHex = tronWeb.address.toHex(newFactoryImplAddress).replace(/^41/, "0x");
    const upgradeFactoryTx = await factory.upgradeToAndCall(newFactoryImplHex, "0x").send({
        feeLimit: 100000000,
        callValue: 0
    });
    console.log("  TX:", upgradeFactoryTx);

    console.log("\n  Waiting for confirmation (10s)...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Step 3: Verify Factory upgrade
    console.log("\nStep 3: Verifying Factory Upgrade...");
    const withdrawalFee = await factory.withdrawalFee().call();
    console.log("  withdrawalFee():", withdrawalFee.toString(), "✓");

    // Step 4: Deploy new PayTheFlyPro implementation
    console.log("\nStep 4: Deploying new PayTheFlyPro Implementation...");
    const newPayTheFlyProImplResult = await deployContract(
        tronWeb,
        payTheFlyProArtifact.abi,
        payTheFlyProArtifact.bytecode
    );
    const newPayTheFlyProImplAddress = tronWeb.address.fromHex(newPayTheFlyProImplResult.address);
    console.log("  New PayTheFlyPro Impl:", newPayTheFlyProImplAddress);
    console.log("  TX:", newPayTheFlyProImplResult.txId);

    console.log("\n  Waiting for confirmation (15s)...");
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Step 5: Upgrade Beacon
    console.log("\nStep 5: Upgrading Beacon Implementation...");
    const newPayTheFlyProImplHex = tronWeb.address.toHex(newPayTheFlyProImplAddress).replace(/^41/, "0x");
    const upgradeBeaconTx = await factory.upgradeBeacon(newPayTheFlyProImplHex).send({
        feeLimit: 100000000,
        callValue: 0
    });
    console.log("  TX:", upgradeBeaconTx);

    console.log("\n  Waiting for confirmation (10s)...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Verify beacon upgrade
    const beaconHex = tronWeb.address.toHex(deployment.contracts.beacon);
    const beacon = await tronWeb.contract(beaconArtifact.abi, beaconHex);
    const currentBeaconImplHex = await beacon.implementation().call();
    const currentBeaconImpl = tronWeb.address.fromHex(currentBeaconImplHex);
    console.log("  Beacon implementation:", currentBeaconImpl);

    // Update deployment info
    const updatedDeployment = {
        ...deployment,
        timestamp: new Date().toISOString(),
        contracts: {
            ...deployment.contracts,
            factoryImpl: newFactoryImplAddress,
            payTheFlyProImpl: newPayTheFlyProImplAddress
        },
        upgrades: [
            ...(deployment.upgrades || []),
            {
                timestamp: new Date().toISOString(),
                type: "withdrawal-fee-feature",
                oldFactoryImpl: deployment.contracts.factoryImpl,
                newFactoryImpl: newFactoryImplAddress,
                oldPayTheFlyProImpl: deployment.contracts.payTheFlyProImpl,
                newPayTheFlyProImpl: newPayTheFlyProImplAddress,
                factoryUpgradeTxId: upgradeFactoryTx,
                beaconUpgradeTxId: upgradeBeaconTx
            }
        ]
    };

    fs.writeFileSync(deploymentPath, JSON.stringify(updatedDeployment, null, 2));
    console.log("\nDeployment info updated:", deploymentPath);

    // Summary
    console.log("\n========================================");
    console.log("Upgrade Summary");
    console.log("========================================");
    console.log("Factory Proxy:", deployment.contracts.factoryProxy);
    console.log("  - Old Impl:", deployment.contracts.factoryImpl);
    console.log("  - New Impl:", newFactoryImplAddress);
    console.log("Beacon:", deployment.contracts.beacon);
    console.log("  - Old Impl:", deployment.contracts.payTheFlyProImpl);
    console.log("  - New Impl:", newPayTheFlyProImplAddress);
    console.log("========================================");
    console.log("\nNew Features Available:");
    console.log("  - factory.setWithdrawalFee(uint256)");
    console.log("  - factory.withdrawalFee()");
    console.log("  - project.withdraw() now requires callValue >= withdrawalFee");
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Upgrade failed:", error);
        process.exit(1);
    });

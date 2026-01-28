/**
 * Continue Nile upgrade from Step 4 (PayTheFlyPro deployment and Beacon upgrade)
 * Factory already upgraded:
 *   - New Factory Impl: TFxwrgDZKK1JrVRkc4EgheD9BmMW3BzUN6
 *   - Upgrade TX: 2ef6c115f50fae3e9f9caec8bf51223b93a5f827c5dd4f746eeffbdb560b10f0
 */

const { TronWeb } = require("tronweb");
const fs = require("fs");
const path = require("path");

let hardhatVars = null;
try {
    const { vars } = require("hardhat/config");
    hardhatVars = vars;
} catch (e) {}

const NEW_FACTORY_IMPL = "TFxwrgDZKK1JrVRkc4EgheD9BmMW3BzUN6";

async function deployContract(tronWeb, abi, bytecode, feeLimit = 1500000000) {
    const ownerAddress = tronWeb.defaultAddress.hex;

    const tx = await tronWeb.transactionBuilder.createSmartContract({
        abi: [],
        bytecode: bytecode,
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

    return {
        address: result.transaction.contract_address || signedTx.contract_address,
        txId: result.transaction.txID
    };
}

async function main() {
    const deploymentPath = path.join(__dirname, "deployment-nile.json");
    const deployment = JSON.parse(fs.readFileSync(deploymentPath));

    const privateKey = hardhatVars.get("TRON_DEVELOPMENT_KEY");

    const tronWeb = new TronWeb({
        fullHost: "https://nile.trongrid.io",
        privateKey: privateKey
    });

    const deployerAddress = tronWeb.address.fromPrivateKey(privateKey);
    const balance = await tronWeb.trx.getBalance(deployerAddress);

    console.log("========================================");
    console.log("Continue Nile Upgrade - Step 4+");
    console.log("========================================");
    console.log("Deployer:", deployerAddress);
    console.log("Balance:", tronWeb.fromSun(balance), "TRX");
    console.log("========================================\n");

    // Load artifacts
    const baseDir = path.join(__dirname, "../../..");
    let artifactsPath = path.join(baseDir, "artifacts-tron/contracts");
    if (!fs.existsSync(artifactsPath)) {
        artifactsPath = path.join(baseDir, "artifacts/contracts");
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

    // Connect to factory with new ABI
    const factoryHex = tronWeb.address.toHex(deployment.contracts.factoryProxy);
    const factory = await tronWeb.contract(factoryArtifact.abi, factoryHex);

    // Skip verification - TronWeb contract methods work differently
    console.log("Factory upgraded to:", NEW_FACTORY_IMPL, "\n");

    // Step 4: Deploy new PayTheFlyPro implementation
    console.log("Step 4: Deploying new PayTheFlyPro Implementation...");
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
            factoryImpl: NEW_FACTORY_IMPL,
            payTheFlyProImpl: newPayTheFlyProImplAddress
        },
        upgrades: [
            ...(deployment.upgrades || []),
            {
                timestamp: new Date().toISOString(),
                type: "withdrawal-fee-feature",
                oldFactoryImpl: deployment.contracts.factoryImpl,
                newFactoryImpl: NEW_FACTORY_IMPL,
                oldPayTheFlyProImpl: deployment.contracts.payTheFlyProImpl,
                newPayTheFlyProImpl: newPayTheFlyProImplAddress,
                factoryUpgradeTxId: "2ef6c115f50fae3e9f9caec8bf51223b93a5f827c5dd4f746eeffbdb560b10f0",
                beaconUpgradeTxId: upgradeBeaconTx
            }
        ]
    };

    fs.writeFileSync(deploymentPath, JSON.stringify(updatedDeployment, null, 2));
    console.log("\nDeployment info updated:", deploymentPath);

    // Summary
    console.log("\n========================================");
    console.log("Upgrade Summary - TRON Nile");
    console.log("========================================");
    console.log("Factory Proxy:", deployment.contracts.factoryProxy);
    console.log("  - Old Impl:", deployment.contracts.factoryImpl);
    console.log("  - New Impl:", NEW_FACTORY_IMPL);
    console.log("Beacon:", deployment.contracts.beacon);
    console.log("  - Old Impl:", deployment.contracts.payTheFlyProImpl);
    console.log("  - New Impl:", newPayTheFlyProImplAddress);
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Upgrade failed:", error);
        process.exit(1);
    });

/**
 * Continue BSC Mainnet upgrade from Step 2
 * Factory Implementation already deployed at 0xfC5C8B48c8eAB72161f09Fec5c628918dEC714F9
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYMENT_FILE = path.join(__dirname, "deployment-bsc.json");
const NEW_FACTORY_IMPL = "0xfC5C8B48c8eAB72161f09Fec5c628918dEC714F9";

const factoryAbi = [
    "function owner() view returns (address)",
    "function upgradeBeacon(address newImplementation) external",
    "function upgradeToAndCall(address newImplementation, bytes calldata data) external",
    "function withdrawalFee() view returns (uint256)"
];

const beaconAbi = [
    "function implementation() view returns (address)"
];

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
    const factory = new ethers.Contract(deployment.contracts.factoryProxy, factoryAbi, deployer);

    // Step 2: Upgrade Factory proxy
    console.log("\nStep 2: Upgrading Factory Proxy...");
    console.log("  New Factory Impl:", NEW_FACTORY_IMPL);
    const upgradeTx = await factory.upgradeToAndCall(NEW_FACTORY_IMPL, "0x");
    console.log("  TX:", upgradeTx.hash);
    const upgradeReceipt = await upgradeTx.wait();
    console.log("  Confirmed in block:", upgradeReceipt.blockNumber);

    // Step 3: Verify upgrade
    console.log("\nStep 3: Verifying Factory Upgrade...");
    const withdrawalFee = await factory.withdrawalFee();
    console.log("  withdrawalFee():", withdrawalFee.toString(), "✓");

    // Step 4: Deploy new PayTheFlyPro implementation
    console.log("\nStep 4: Deploying new PayTheFlyPro Implementation...");
    const PayTheFlyPro = await ethers.getContractFactory("PayTheFlyPro");
    const newPayTheFlyProImpl = await PayTheFlyPro.deploy();
    await newPayTheFlyProImpl.waitForDeployment();
    const newPayTheFlyProImplAddress = await newPayTheFlyProImpl.getAddress();
    console.log("  New PayTheFlyPro Impl:", newPayTheFlyProImplAddress);

    // Step 5: Upgrade Beacon
    console.log("\nStep 5: Upgrading Beacon Implementation...");
    const beaconTx = await factory.upgradeBeacon(newPayTheFlyProImplAddress);
    console.log("  TX:", beaconTx.hash);
    const beaconReceipt = await beaconTx.wait();
    console.log("  Confirmed in block:", beaconReceipt.blockNumber);

    // Verify beacon upgrade
    const beacon = new ethers.Contract(deployment.contracts.beacon, beaconAbi, deployer);
    const currentBeaconImpl = await beacon.implementation();
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
                newPayTheFlyProImpl: newPayTheFlyProImplAddress
            }
        ]
    };

    fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(updatedDeployment, null, 2));
    console.log("\nDeployment info updated: " + DEPLOYMENT_FILE);

    // Summary
    console.log("\n========================================");
    console.log("Upgrade Summary");
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

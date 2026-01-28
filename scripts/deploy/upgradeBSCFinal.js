/**
 * Final step: Upgrade Beacon on BSC Mainnet
 * - Factory Impl: 0xfC5C8B48c8eAB72161f09Fec5c628918dEC714F9 (deployed)
 * - Factory upgraded in block: 77907621
 * - PayTheFlyPro Impl: 0x9b99bC4d59d1632d78592D51072148281725f68a (deployed)
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYMENT_FILE = path.join(__dirname, "deployment-bsc.json");
const NEW_FACTORY_IMPL = "0xfC5C8B48c8eAB72161f09Fec5c628918dEC714F9";
const NEW_PAYTHFLYPRO_IMPL = "0x9b99bC4d59d1632d78592D51072148281725f68a";

const factoryAbi = [
    "function upgradeBeacon(address newImplementation) external"
];

const beaconAbi = [
    "function implementation() view returns (address)"
];

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
    const factory = new ethers.Contract(deployment.contracts.factoryProxy, factoryAbi, deployer);

    // Step 5: Upgrade Beacon
    console.log("\nStep 5: Upgrading Beacon Implementation...");
    console.log("  New PayTheFlyPro Impl:", NEW_PAYTHFLYPRO_IMPL);
    const beaconTx = await factory.upgradeBeacon(NEW_PAYTHFLYPRO_IMPL);
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
            payTheFlyProImpl: NEW_PAYTHFLYPRO_IMPL
        },
        upgrades: [
            ...(deployment.upgrades || []),
            {
                timestamp: new Date().toISOString(),
                type: "withdrawal-fee-feature",
                oldFactoryImpl: deployment.contracts.factoryImpl,
                newFactoryImpl: NEW_FACTORY_IMPL,
                oldPayTheFlyProImpl: deployment.contracts.payTheFlyProImpl,
                newPayTheFlyProImpl: NEW_PAYTHFLYPRO_IMPL
            }
        ]
    };

    fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(updatedDeployment, null, 2));
    console.log("\nDeployment info updated: " + DEPLOYMENT_FILE);

    // Summary
    console.log("\n========================================");
    console.log("BSC Mainnet Upgrade Complete");
    console.log("========================================");
    console.log("Factory Proxy:", deployment.contracts.factoryProxy);
    console.log("  - Old Impl:", deployment.contracts.factoryImpl);
    console.log("  - New Impl:", NEW_FACTORY_IMPL);
    console.log("Beacon:", deployment.contracts.beacon);
    console.log("  - Old Impl:", deployment.contracts.payTheFlyProImpl);
    console.log("  - New Impl:", NEW_PAYTHFLYPRO_IMPL);
    console.log("========================================");
    console.log("\nNew Features Available:");
    console.log("  - factory.setWithdrawalFee(uint256)");
    console.log("  - factory.withdrawalFee()");
    console.log("  - project.withdraw() now requires msg.value >= withdrawalFee");
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Upgrade failed:", error);
        process.exit(1);
    });

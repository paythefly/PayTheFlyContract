/**
 * Manual Upgrade PayTheFlyPro contracts on BSC Testnet
 * - Deploys new Factory implementation and upgrades via upgradeToAndCall
 * - Deploys new PayTheFlyPro implementation and upgrades beacon
 *
 * Usage:
 *   npx hardhat run scripts/deploy/upgradeBSCTestnetManual.js --network bscTestnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// BSC Testnet deployment info
const DEPLOYMENT_FILE = path.join(__dirname, "deployment-bscTestnet.json");

const factoryAbi = [
    "function owner() view returns (address)",
    "function feeVault() view returns (address)",
    "function feeRate() view returns (uint256)",
    "function beacon() view returns (address)",
    "function upgradeBeacon(address newImplementation) external",
    "function upgradeToAndCall(address newImplementation, bytes calldata data) external",
    "function withdrawalFee() view returns (uint256)",
    "function setWithdrawalFee(uint256 fee) external"
];

const beaconAbi = [
    "function implementation() view returns (address)"
];

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("========================================");
    console.log("PayTheFlyPro Manual Upgrade - BSC Testnet");
    console.log("========================================");
    console.log("Network:", network.name, `(chainId: ${network.chainId})`);
    console.log("Deployer:", deployer.address);

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(balance), "BNB");
    console.log("========================================\n");

    // Load existing deployment info
    if (!fs.existsSync(DEPLOYMENT_FILE)) {
        throw new Error("Deployment file not found: " + DEPLOYMENT_FILE);
    }
    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));

    console.log("Current Deployment:");
    console.log("  Factory Proxy:", deployment.contracts.factoryProxy);
    console.log("  Factory Impl:", deployment.contracts.factoryImpl);
    console.log("  Beacon:", deployment.contracts.beacon);
    console.log("  PayTheFlyPro Impl:", deployment.contracts.payTheFlyProImpl);
    console.log("");

    // Connect to existing Factory
    const factory = new ethers.Contract(deployment.contracts.factoryProxy, factoryAbi, deployer);

    // Verify ownership
    const owner = await factory.owner();
    if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
        throw new Error(`Not owner. Owner is ${owner}, deployer is ${deployer.address}`);
    }
    console.log("Ownership verified ✓\n");

    // Step 1: Deploy new Factory implementation
    console.log("Step 1: Deploying new PayTheFlyProFactory Implementation...");
    const PayTheFlyProFactory = await ethers.getContractFactory("PayTheFlyProFactory");
    const newFactoryImpl = await PayTheFlyProFactory.deploy();
    await newFactoryImpl.waitForDeployment();
    const newFactoryImplAddress = await newFactoryImpl.getAddress();
    console.log("  New Factory Impl:", newFactoryImplAddress);
    console.log("");

    // Step 2: Upgrade Factory proxy
    console.log("Step 2: Upgrading Factory Proxy...");
    const upgradeTx = await factory.upgradeToAndCall(newFactoryImplAddress, "0x");
    console.log("  TX:", upgradeTx.hash);
    const upgradeReceipt = await upgradeTx.wait();
    console.log("  Confirmed in block:", upgradeReceipt.blockNumber);
    console.log("");

    // Verify upgrade - call new function
    console.log("Step 3: Verifying Factory Upgrade...");
    const withdrawalFee = await factory.withdrawalFee();
    console.log("  withdrawalFee():", withdrawalFee.toString(), "✓");
    console.log("");

    // Step 4: Deploy new PayTheFlyPro implementation
    console.log("Step 4: Deploying new PayTheFlyPro Implementation...");
    const PayTheFlyPro = await ethers.getContractFactory("PayTheFlyPro");
    const newPayTheFlyProImpl = await PayTheFlyPro.deploy();
    await newPayTheFlyProImpl.waitForDeployment();
    const newPayTheFlyProImplAddress = await newPayTheFlyProImpl.getAddress();
    console.log("  New PayTheFlyPro Impl:", newPayTheFlyProImplAddress);
    console.log("");

    // Step 5: Upgrade Beacon
    console.log("Step 5: Upgrading Beacon Implementation...");
    const beaconTx = await factory.upgradeBeacon(newPayTheFlyProImplAddress);
    console.log("  TX:", beaconTx.hash);
    const beaconReceipt = await beaconTx.wait();
    console.log("  Confirmed in block:", beaconReceipt.blockNumber);
    console.log("");

    // Verify beacon upgrade
    const beacon = new ethers.Contract(deployment.contracts.beacon, beaconAbi, deployer);
    const currentBeaconImpl = await beacon.implementation();
    console.log("  Beacon implementation:", currentBeaconImpl);
    console.log("");

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
                newPayTheFlyProImpl: newPayTheFlyProImplAddress
            }
        ]
    };

    fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(updatedDeployment, null, 2));
    console.log("Deployment info updated: " + DEPLOYMENT_FILE);

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
    console.log("  - project.withdraw() now requires msg.value >= withdrawalFee");
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Upgrade failed:", error);
        process.exit(1);
    });

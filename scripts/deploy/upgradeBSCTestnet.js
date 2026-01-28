/**
 * Upgrade PayTheFlyPro contracts on BSC Testnet
 * - Upgrades Factory (UUPS) to add withdrawalFee feature
 * - Upgrades Beacon implementation to add withdraw fee collection
 *
 * Usage:
 *   npx hardhat run scripts/deploy/upgradeBSCTestnet.js --network bscTestnet
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

// BSC Testnet deployment info
const DEPLOYMENT_FILE = path.join(__dirname, "deployment-bscTestnet.json");

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("========================================");
    console.log("PayTheFlyPro Upgrade - BSC Testnet");
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

    // Get existing Factory contract
    const PayTheFlyProFactory = await ethers.getContractFactory("PayTheFlyProFactory");
    const factory = PayTheFlyProFactory.attach(deployment.contracts.factoryProxy);

    // Verify ownership
    const owner = await factory.owner();
    if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
        throw new Error(`Not owner. Owner is ${owner}, deployer is ${deployer.address}`);
    }
    console.log("Ownership verified ✓\n");

    // Step 1: Upgrade Factory (UUPS)
    console.log("Step 1: Upgrading Factory Implementation...");
    const upgradedFactory = await upgrades.upgradeProxy(
        deployment.contracts.factoryProxy,
        PayTheFlyProFactory
    );
    await upgradedFactory.waitForDeployment();

    const newFactoryImpl = await upgrades.erc1967.getImplementationAddress(
        deployment.contracts.factoryProxy
    );
    console.log("  Old Factory Impl:", deployment.contracts.factoryImpl);
    console.log("  New Factory Impl:", newFactoryImpl);

    // Verify new function exists
    const withdrawalFee = await upgradedFactory.withdrawalFee();
    console.log("  withdrawalFee():", withdrawalFee.toString(), "✓");
    console.log("");

    // Step 2: Deploy new PayTheFlyPro implementation
    console.log("Step 2: Deploying new PayTheFlyPro Implementation...");
    const PayTheFlyPro = await ethers.getContractFactory("PayTheFlyPro");
    const newPayTheFlyProImpl = await PayTheFlyPro.deploy();
    await newPayTheFlyProImpl.waitForDeployment();
    const newPayTheFlyProImplAddress = await newPayTheFlyProImpl.getAddress();
    console.log("  Old PayTheFlyPro Impl:", deployment.contracts.payTheFlyProImpl);
    console.log("  New PayTheFlyPro Impl:", newPayTheFlyProImplAddress);
    console.log("");

    // Step 3: Upgrade Beacon
    console.log("Step 3: Upgrading Beacon Implementation...");
    const tx = await upgradedFactory.upgradeBeacon(newPayTheFlyProImplAddress);
    console.log("  TX:", tx.hash);
    const receipt = await tx.wait();
    console.log("  Confirmed in block:", receipt.blockNumber);

    // Verify beacon upgrade
    const Beacon = await ethers.getContractFactory("UpgradeableBeacon");
    const beacon = Beacon.attach(deployment.contracts.beacon);
    const currentBeaconImpl = await beacon.implementation();
    console.log("  Beacon implementation:", currentBeaconImpl);
    console.log("");

    // Update deployment info
    const updatedDeployment = {
        ...deployment,
        timestamp: new Date().toISOString(),
        contracts: {
            ...deployment.contracts,
            factoryImpl: newFactoryImpl,
            payTheFlyProImpl: newPayTheFlyProImplAddress
        },
        upgrades: [
            ...(deployment.upgrades || []),
            {
                timestamp: new Date().toISOString(),
                type: "withdrawal-fee-feature",
                oldFactoryImpl: deployment.contracts.factoryImpl,
                newFactoryImpl: newFactoryImpl,
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
    console.log("  - New Impl:", newFactoryImpl);
    console.log("Beacon:", deployment.contracts.beacon);
    console.log("  - Old Impl:", deployment.contracts.payTheFlyProImpl);
    console.log("  - New Impl:", newPayTheFlyProImplAddress);
    console.log("========================================");
    console.log("\nNew Features Available:");
    console.log("  - factory.setWithdrawalFee(uint256)");
    console.log("  - factory.withdrawalFee()");
    console.log("  - project.withdraw() now accepts payable with fee");
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Upgrade failed:", error);
        process.exit(1);
    });

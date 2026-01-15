/**
 * Upgrade PayTheFlyProFactory (UUPS)
 *
 * Usage:
 *   FACTORY=0x... npx hardhat run scripts/deploy/upgradeFactory.js --network localhost
 */

const { ethers, upgrades } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("========================================");
    console.log("Upgrade PayTheFlyProFactory");
    console.log("========================================");
    console.log("Network:", network.name, `(chainId: ${network.chainId})`);
    console.log("Upgrader:", deployer.address);
    console.log("========================================\n");

    const factoryAddress = process.env.FACTORY;
    if (!factoryAddress) {
        throw new Error("FACTORY environment variable is required");
    }

    console.log("Factory Proxy Address:", factoryAddress);

    // Get current implementation
    const currentImpl = await upgrades.erc1967.getImplementationAddress(factoryAddress);
    console.log("Current Implementation:", currentImpl);

    // Check owner
    const factory = await ethers.getContractAt("PayTheFlyProFactory", factoryAddress);
    const owner = await factory.owner();
    console.log("Factory Owner:", owner);

    if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
        throw new Error(`Deployer ${deployer.address} is not the owner ${owner}`);
    }

    // Upgrade
    console.log("\nUpgrading factory...");
    const PayTheFlyProFactoryV2 = await ethers.getContractFactory("PayTheFlyProFactory");
    const upgraded = await upgrades.upgradeProxy(factoryAddress, PayTheFlyProFactoryV2);
    await upgraded.waitForDeployment();

    // Get new implementation
    const newImpl = await upgrades.erc1967.getImplementationAddress(factoryAddress);
    console.log("New Implementation:", newImpl);

    // Verify state preservation
    console.log("\nVerifying state preservation...");
    console.log("  Owner:", await upgraded.owner());
    console.log("  Fee Vault:", await upgraded.feeVault());
    console.log("  Fee Rate:", await upgraded.feeRate());
    console.log("  Beacon:", await upgraded.beacon());

    console.log("\n========================================");
    console.log("Upgrade Complete");
    console.log("========================================");
    console.log("Old Implementation:", currentImpl);
    console.log("New Implementation:", newImpl);
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

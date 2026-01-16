/**
 * Upgrade PayTheFlyPro implementation via Beacon
 *
 * Usage:
 *   FACTORY=0x... npx hardhat run scripts/deploy/upgradeBeacon.js --network localhost
 */

const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("========================================");
    console.log("Upgrade PayTheFlyPro via Beacon");
    console.log("========================================");
    console.log("Network:", network.name, `(chainId: ${network.chainId})`);
    console.log("Upgrader:", deployer.address);
    console.log("========================================\n");

    const factoryAddress = process.env.FACTORY;
    if (!factoryAddress) {
        throw new Error("FACTORY environment variable is required");
    }

    // Get factory contract
    const factory = await ethers.getContractAt("PayTheFlyProFactory", factoryAddress);

    // Check owner
    const owner = await factory.owner();
    console.log("Factory Owner:", owner);

    if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
        throw new Error(`Deployer ${deployer.address} is not the owner ${owner}`);
    }

    // Get beacon address
    const beaconAddress = await factory.beacon();
    console.log("Beacon Address:", beaconAddress);

    // Get current implementation from beacon
    const beacon = await ethers.getContractAt("UpgradeableBeacon", beaconAddress);
    const currentImpl = await beacon.implementation();
    console.log("Current Implementation:", currentImpl);

    // Deploy new implementation
    console.log("\nDeploying new PayTheFlyPro implementation...");
    const PayTheFlyPro = await ethers.getContractFactory("PayTheFlyPro");
    const newPayTheFlyProImpl = await PayTheFlyPro.deploy();
    await newPayTheFlyProImpl.waitForDeployment();
    const newImplAddress = await newPayTheFlyProImpl.getAddress();
    console.log("New Implementation Address:", newImplAddress);

    // Upgrade beacon via factory
    console.log("\nUpgrading beacon...");
    const tx = await factory.upgradeBeacon(newImplAddress);
    console.log("Transaction hash:", tx.hash);
    await tx.wait();

    // Verify upgrade
    const updatedImpl = await beacon.implementation();
    console.log("Updated Implementation:", updatedImpl);

    if (updatedImpl.toLowerCase() !== newImplAddress.toLowerCase()) {
        throw new Error("Upgrade verification failed!");
    }

    console.log("\n========================================");
    console.log("Beacon Upgrade Complete");
    console.log("========================================");
    console.log("Old Implementation:", currentImpl);
    console.log("New Implementation:", newImplAddress);
    console.log("========================================");
    console.log("\nAll existing projects will now use the new implementation!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

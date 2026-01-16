/**
 * Deploy PayTheFlyProFactory with UUPS proxy and UpgradeableBeacon
 *
 * Usage:
 *   npx hardhat run scripts/deploy/deployFactory.js --network localhost
 *   npx hardhat run scripts/deploy/deployFactory.js --network bscTestnet
 *   npx hardhat run scripts/deploy/deployFactory.js --network sepolia
 */

const { ethers, upgrades } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("========================================");
    console.log("PayTheFlyPro Factory Deployment");
    console.log("========================================");
    console.log("Network:", network.name, `(chainId: ${network.chainId})`);
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
    console.log("========================================\n");

    // Configuration - adjust these values per network
    const config = getNetworkConfig(network.chainId);
    console.log("Configuration:");
    console.log("  Fee Vault:", config.feeVault);
    console.log("  Fee Rate:", config.feeRate, "basis points (", config.feeRate / 100, "%)");
    console.log("");

    // Step 1: Deploy PayTheFlyPro implementation
    console.log("Step 1: Deploying PayTheFlyPro implementation...");
    const PayTheFlyPro = await ethers.getContractFactory("PayTheFlyPro");
    const payTheFlyProImpl = await PayTheFlyPro.deploy();
    await payTheFlyProImpl.waitForDeployment();
    const implAddress = await payTheFlyProImpl.getAddress();
    console.log("  PayTheFlyPro Implementation:", implAddress);

    // Step 2: Deploy PayTheFlyProFactory with UUPS proxy
    console.log("\nStep 2: Deploying PayTheFlyProFactory (UUPS Proxy)...");
    const PayTheFlyProFactory = await ethers.getContractFactory("PayTheFlyProFactory");
    const factory = await upgrades.deployProxy(
        PayTheFlyProFactory,
        [implAddress, config.feeVault, config.feeRate],
        {
            kind: "uups",
            initializer: "initialize"
        }
    );
    await factory.waitForDeployment();
    const factoryAddress = await factory.getAddress();
    console.log("  Factory Proxy:", factoryAddress);

    // Get implementation address
    const factoryImplAddress = await upgrades.erc1967.getImplementationAddress(factoryAddress);
    console.log("  Factory Implementation:", factoryImplAddress);

    // Get beacon address
    const beaconAddress = await factory.beacon();
    console.log("  Beacon:", beaconAddress);

    // Verify deployment
    console.log("\nStep 3: Verifying deployment...");
    const verifyFactory = await ethers.getContractAt("PayTheFlyProFactory", factoryAddress);
    console.log("  Owner:", await verifyFactory.owner());
    console.log("  Fee Vault:", await verifyFactory.feeVault());
    console.log("  Fee Rate:", await verifyFactory.feeRate());
    console.log("  Beacon:", await verifyFactory.beacon());

    // Summary
    console.log("\n========================================");
    console.log("Deployment Summary");
    console.log("========================================");
    console.log("PayTheFlyPro Implementation:", implAddress);
    console.log("PayTheFlyProFactory Proxy:", factoryAddress);
    console.log("PayTheFlyProFactory Implementation:", factoryImplAddress);
    console.log("UpgradeableBeacon:", beaconAddress);
    console.log("========================================");

    // Save deployment info
    const deploymentInfo = {
        network: network.name,
        chainId: Number(network.chainId),
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        contracts: {
            payTheFlyProImpl: implAddress,
            factoryProxy: factoryAddress,
            factoryImpl: factoryImplAddress,
            beacon: beaconAddress
        },
        config: {
            feeVault: config.feeVault,
            feeRate: config.feeRate
        }
    };

    console.log("\nDeployment Info (JSON):");
    console.log(JSON.stringify(deploymentInfo, null, 2));

    return deploymentInfo;
}

function getNetworkConfig(chainId) {
    const configs = {
        // Localhost / Hardhat
        31337: {
            feeVault: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // Default hardhat account 0
            feeRate: 100 // 1%
        },
        // Ethereum Mainnet
        1: {
            feeVault: process.env.FEE_VAULT || "0x0000000000000000000000000000000000000000",
            feeRate: 100
        },
        // Sepolia Testnet
        11155111: {
            feeVault: process.env.FEE_VAULT || "0x0000000000000000000000000000000000000000",
            feeRate: 100
        },
        // BSC Mainnet
        56: {
            feeVault: process.env.FEE_VAULT || "0x0000000000000000000000000000000000000000",
            feeRate: 100
        },
        // BSC Testnet
        97: {
            feeVault: process.env.FEE_VAULT || "0x0000000000000000000000000000000000000000",
            feeRate: 100
        },
        // Polygon Mainnet
        137: {
            feeVault: process.env.FEE_VAULT || "0x0000000000000000000000000000000000000000",
            feeRate: 100
        },
        // Polygon Mumbai
        80001: {
            feeVault: process.env.FEE_VAULT || "0x0000000000000000000000000000000000000000",
            feeRate: 100
        }
    };

    const config = configs[Number(chainId)];
    if (!config) {
        console.warn(`Warning: No config found for chainId ${chainId}, using defaults`);
        return {
            feeVault: process.env.FEE_VAULT || "0x0000000000000000000000000000000000000000",
            feeRate: 100
        };
    }

    // Override with environment variables if set
    if (process.env.FEE_VAULT) {
        config.feeVault = process.env.FEE_VAULT;
    }
    if (process.env.FEE_RATE) {
        config.feeRate = parseInt(process.env.FEE_RATE);
    }

    return config;
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

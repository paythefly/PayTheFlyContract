/**
 * ETH Mainnet Factory Deployment
 *
 * Usage:
 *   FEE_VAULT=0x... node scripts/deploy/deployFactoryETH.js
 *   FEE_VAULT=0x... FEE_RATE=20 node scripts/deploy/deployFactoryETH.js
 */

const { ethers, ContractFactory } = require("ethers");
const fs = require("fs");
const path = require("path");

// Get private key from hardhat vars
const hre = require("hardhat");
const { vars } = require("hardhat/config");
const privateKey = vars.get("PRODUCT_KEY");

const feeVault = process.env.FEE_VAULT;
if (!feeVault) {
    console.error("Error: FEE_VAULT environment variable required");
    process.exit(1);
}
const feeRate = parseInt(process.env.FEE_RATE || "20"); // Default 0.2%

// ETH Mainnet RPC
const ETH_RPC = process.env.ETH_RPC || "https://eth.llamarpc.com";

async function main() {
    // Use native ethers provider and wallet
    const provider = new ethers.JsonRpcProvider(ETH_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);

    const network = await provider.getNetwork();
    const balance = await provider.getBalance(wallet.address);

    console.log("========================================");
    console.log("PayTheFlyPro Factory ETH Mainnet Deployment");
    console.log("========================================");
    console.log("Network: Ethereum Mainnet (chainId:", network.chainId.toString() + ")");
    console.log("Deployer:", wallet.address);
    console.log("Balance:", ethers.formatEther(balance), "ETH");
    console.log("========================================\n");

    console.log("Configuration:");
    console.log("  Fee Vault:", feeVault);
    console.log("  Fee Rate:", feeRate, "basis points (", feeRate / 100, "%)");
    console.log("");

    // Check balance
    if (balance < ethers.parseEther("0.1")) {
        console.error("Warning: Low balance! Deployment may fail.");
        console.error("Recommended: At least 0.1 ETH for deployment gas fees.");
    }

    // Load contract artifacts
    const baseDir = path.join(__dirname, "../..");
    const artifactsPath = path.join(baseDir, "artifacts/contracts");

    const payTheFlyProArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyPro.sol/PayTheFlyPro.json"))
    );
    const factoryArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyProFactory.sol/PayTheFlyProFactory.json"))
    );
    const proxyArtifactPath = path.join(baseDir, "artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json");
    const proxyArtifact = JSON.parse(fs.readFileSync(proxyArtifactPath));

    // Gas configuration
    const feeData = await provider.getFeeData();
    console.log("Gas Price:", ethers.formatUnits(feeData.gasPrice, "gwei"), "gwei");
    console.log("Max Fee Per Gas:", ethers.formatUnits(feeData.maxFeePerGas || 0n, "gwei"), "gwei");
    console.log("Max Priority Fee:", ethers.formatUnits(feeData.maxPriorityFeePerGas || 0n, "gwei"), "gwei\n");

    // Helper function: deploy contract and wait for confirmation
    async function deployContract(name, artifact, args = []) {
        console.log(`Deploying ${name}...`);

        const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
        const deployTx = await factory.getDeployTransaction(...args);

        // Use EIP-1559 transaction for ETH mainnet
        const tx = await wallet.sendTransaction({
            data: deployTx.data,
            gasLimit: 8000000,
            maxFeePerGas: feeData.maxFeePerGas,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
        });

        console.log("  TX:", tx.hash);
        console.log("  Waiting for confirmation...");

        // Wait for confirmation
        let receipt = null;
        for (let i = 0; i < 120; i++) { // 6 minutes timeout for ETH
            receipt = await provider.getTransactionReceipt(tx.hash);
            if (receipt) {
                if (receipt.status === 1) {
                    console.log("  Confirmed in block:", receipt.blockNumber);
                    console.log("  Contract:", receipt.contractAddress);
                    console.log("  Gas Used:", receipt.gasUsed.toString());
                    return receipt.contractAddress;
                } else {
                    throw new Error(`${name} deployment failed (status=0)`);
                }
            }
            await new Promise(r => setTimeout(r, 3000));
        }
        throw new Error(`${name} deployment timeout`);
    }

    // Step 1: Deploy PayTheFlyPro implementation
    console.log("Step 1:");
    const implAddress = await deployContract("PayTheFlyPro Implementation", payTheFlyProArtifact);

    // Step 2: Deploy PayTheFlyProFactory implementation
    console.log("\nStep 2:");
    const factoryImplAddress = await deployContract("PayTheFlyProFactory Implementation", factoryArtifact);

    // Step 3: Prepare initialize calldata
    console.log("\nStep 3: Preparing initialize calldata...");
    const factoryInterface = new ethers.Interface(factoryArtifact.abi);
    const initData = factoryInterface.encodeFunctionData("initialize", [
        implAddress,
        feeVault,
        feeRate
    ]);
    console.log("  Init data:", initData.slice(0, 66) + "...");

    // Step 4: Deploy ERC1967Proxy
    console.log("\nStep 4:");
    const proxyAddress = await deployContract("ERC1967Proxy", proxyArtifact, [factoryImplAddress, initData]);

    // Step 5: Verify deployment
    console.log("\nStep 5: Verifying deployment...");
    const factoryContract = new ethers.Contract(proxyAddress, factoryArtifact.abi, provider);

    const owner = await factoryContract.owner();
    const storedFeeVault = await factoryContract.feeVault();
    const storedFeeRate = await factoryContract.feeRate();
    const beaconAddress = await factoryContract.beacon();

    console.log("  Owner:", owner);
    console.log("  Fee Vault:", storedFeeVault);
    console.log("  Fee Rate:", storedFeeRate.toString());
    console.log("  Beacon:", beaconAddress);

    // Summary
    console.log("\n========================================");
    console.log("Deployment Summary");
    console.log("========================================");
    console.log("PayTheFlyPro Implementation:", implAddress);
    console.log("PayTheFlyProFactory Implementation:", factoryImplAddress);
    console.log("PayTheFlyProFactory Proxy:", proxyAddress);
    console.log("UpgradeableBeacon:", beaconAddress);
    console.log("========================================");

    // Save deployment info
    const deploymentInfo = {
        network: "mainnet",
        networkName: "Ethereum Mainnet",
        chainId: 1,
        deployer: wallet.address,
        timestamp: new Date().toISOString(),
        contracts: {
            payTheFlyProImpl: implAddress,
            factoryProxy: proxyAddress,
            factoryImpl: factoryImplAddress,
            beacon: beaconAddress
        },
        config: {
            feeVault: feeVault,
            feeRate: feeRate
        }
    };

    console.log("\nDeployment Info (JSON):");
    console.log(JSON.stringify(deploymentInfo, null, 2));

    // Save to file
    const outputPath = path.join(__dirname, "deployment-eth.json");
    fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`\nDeployment info saved to: ${outputPath}`);

    console.log("\n========================================");
    console.log("Next Steps:");
    console.log("========================================");
    console.log("1. Verify contracts on Etherscan:");
    console.log(`   npx hardhat verify --network mainnet ${implAddress}`);
    console.log(`   npx hardhat verify --network mainnet ${factoryImplAddress}`);
    console.log(`   npx hardhat verify --network mainnet ${proxyAddress} ${factoryImplAddress} ${initData}`);
    console.log("");
    console.log("2. Set withdrawal fee (optional):");
    console.log("   FACTORY=" + proxyAddress + " FEE=0.0001 npx hardhat run scripts/deploy/setWithdrawalFee.js --network mainnet");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });

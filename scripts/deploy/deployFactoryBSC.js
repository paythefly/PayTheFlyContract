/**
 * BSC Factory Deployment - 使用原生 ethers.js 避免 hardhat-ethers 兼容性问题
 *
 * Usage:
 *   FEE_VAULT=0x... node scripts/deploy/deployFactoryBSC.js
 */

const { ethers, ContractFactory } = require("ethers");
const fs = require("fs");
const path = require("path");

// 从 hardhat 获取私钥
const hre = require("hardhat");
const { vars } = require("hardhat/config");
const privateKey = vars.get("PRODUCT_KEY");

const feeVault = process.env.FEE_VAULT;
if (!feeVault) {
    console.error("Error: FEE_VAULT environment variable required");
    process.exit(1);
}
const feeRate = parseInt(process.env.FEE_RATE || "100");

// BSC 配置
const BSC_RPC = "https://bsc-dataseed1.binance.org";

async function main() {
    // 使用原生 ethers provider 和 wallet
    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);

    const network = await provider.getNetwork();
    const balance = await provider.getBalance(wallet.address);

    console.log("========================================");
    console.log("PayTheFlyPro Factory BSC Deployment");
    console.log("========================================");
    console.log("Network: BSC Mainnet (chainId:", network.chainId.toString() + ")");
    console.log("Deployer:", wallet.address);
    console.log("Balance:", ethers.formatEther(balance), "BNB");
    console.log("========================================\n");

    console.log("Configuration:");
    console.log("  Fee Vault:", feeVault);
    console.log("  Fee Rate:", feeRate, "basis points (", feeRate / 100, "%)");
    console.log("");

    // 加载合约 artifacts
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

    // Gas 配置
    const gasPrice = (await provider.getFeeData()).gasPrice;
    console.log("Gas Price:", ethers.formatUnits(gasPrice, "gwei"), "gwei\n");

    // 辅助函数：部署合约并等待确认
    async function deployContract(name, artifact, args = []) {
        console.log(`Deploying ${name}...`);

        const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
        const deployTx = await factory.getDeployTransaction(...args);

        const tx = await wallet.sendTransaction({
            data: deployTx.data,
            gasLimit: 8000000,
            gasPrice: gasPrice
        });

        console.log("  TX:", tx.hash);
        console.log("  Waiting for confirmation...");

        // 等待交易确认
        let receipt = null;
        for (let i = 0; i < 60; i++) {
            receipt = await provider.getTransactionReceipt(tx.hash);
            if (receipt) {
                if (receipt.status === 1) {
                    console.log("  Confirmed in block:", receipt.blockNumber);
                    console.log("  Contract:", receipt.contractAddress);
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
        network: "bsc",
        chainId: 56,
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
    const outputPath = path.join(__dirname, "deployment-bsc.json");
    fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`\nDeployment info saved to: ${outputPath}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });

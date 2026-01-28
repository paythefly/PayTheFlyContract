/**
 * Manual Factory Deployment for BSC (避免 RPC 兼容性问题)
 *
 * Usage:
 *   FEE_VAULT=0x... npx hardhat run scripts/deploy/deployFactoryManual.js --network bsc
 */

const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("========================================");
    console.log("PayTheFlyPro Factory Manual Deployment");
    console.log("========================================");
    console.log("Network:", network.name, `(chainId: ${network.chainId})`);
    console.log("Deployer:", deployer.address);

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(balance), "BNB");
    console.log("========================================\n");

    const feeVault = process.env.FEE_VAULT;
    if (!feeVault) {
        throw new Error("FEE_VAULT environment variable is required");
    }
    const feeRate = parseInt(process.env.FEE_RATE || "100");

    console.log("Configuration:");
    console.log("  Fee Vault:", feeVault);
    console.log("  Fee Rate:", feeRate, "basis points (", feeRate / 100, "%)");
    console.log("");

    // Override options to force legacy transaction
    const txOverrides = {
        gasLimit: 8000000,
        gasPrice: (await ethers.provider.getFeeData()).gasPrice
    };
    console.log("Gas Price:", ethers.formatUnits(txOverrides.gasPrice, "gwei"), "gwei\n");

    // Helper function to wait for transaction with BSC-compatible method
    async function waitForTx(txResponse, name) {
        console.log("  TX sent:", txResponse.hash);
        console.log("  Waiting for confirmation...");

        // Wait for transaction to be mined by checking receipt directly
        let receipt = null;
        for (let i = 0; i < 60; i++) {
            try {
                receipt = await ethers.provider.getTransactionReceipt(txResponse.hash);
                if (receipt && receipt.status === 1) {
                    console.log("  Confirmed in block:", receipt.blockNumber);
                    return receipt;
                } else if (receipt && receipt.status === 0) {
                    throw new Error(`${name} transaction failed!`);
                }
            } catch (e) {
                if (e.message.includes("transaction failed")) throw e;
            }
            await new Promise(r => setTimeout(r, 3000));
        }
        throw new Error(`${name} transaction timeout`);
    }

    // Step 1: Deploy PayTheFlyPro implementation
    console.log("Step 1: Deploying PayTheFlyPro implementation...");
    const PayTheFlyPro = await ethers.getContractFactory("PayTheFlyPro");
    const payTheFlyProDeployTx = await PayTheFlyPro.getDeployTransaction(txOverrides);
    const payTheFlyProTxResponse = await deployer.sendTransaction(payTheFlyProDeployTx);
    const payTheFlyProReceipt = await waitForTx(payTheFlyProTxResponse, "PayTheFlyPro");
    const implAddress = payTheFlyProReceipt.contractAddress;
    console.log("  PayTheFlyPro Implementation:", implAddress);

    // Step 2: Deploy PayTheFlyProFactory implementation
    console.log("\nStep 2: Deploying PayTheFlyProFactory implementation...");
    const PayTheFlyProFactory = await ethers.getContractFactory("PayTheFlyProFactory");
    const factoryImplDeployTx = await PayTheFlyProFactory.getDeployTransaction(txOverrides);
    const factoryImplTxResponse = await deployer.sendTransaction(factoryImplDeployTx);
    const factoryImplReceipt = await waitForTx(factoryImplTxResponse, "PayTheFlyProFactory");
    const factoryImplAddress = factoryImplReceipt.contractAddress;
    console.log("  Factory Implementation:", factoryImplAddress);

    // Step 3: Encode initialize calldata
    console.log("\nStep 3: Encoding initialize calldata...");
    const initData = PayTheFlyProFactory.interface.encodeFunctionData("initialize", [
        implAddress,
        feeVault,
        feeRate
    ]);
    console.log("  Init data:", initData.slice(0, 66) + "...");

    // Step 4: Deploy ERC1967Proxy
    console.log("\nStep 4: Deploying ERC1967Proxy...");
    const ERC1967Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxyDeployTx = await ERC1967Proxy.getDeployTransaction(factoryImplAddress, initData, txOverrides);
    const proxyTxResponse = await deployer.sendTransaction(proxyDeployTx);
    const proxyReceipt = await waitForTx(proxyTxResponse, "ERC1967Proxy");
    const proxyAddress = proxyReceipt.contractAddress;
    console.log("  Factory Proxy:", proxyAddress);

    // Step 5: Verify deployment
    console.log("\nStep 5: Verifying deployment...");
    const factory = PayTheFlyProFactory.attach(proxyAddress);

    const owner = await factory.owner();
    const storedFeeVault = await factory.feeVault();
    const storedFeeRate = await factory.feeRate();
    const beaconAddress = await factory.beacon();

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
        network: network.name,
        chainId: Number(network.chainId),
        deployer: deployer.address,
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
    const fs = require("fs");
    const path = require("path");
    const outputPath = path.join(__dirname, `deployment-${network.name}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`\nDeployment info saved to: ${outputPath}`);

    return deploymentInfo;
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

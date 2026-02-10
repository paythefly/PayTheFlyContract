/**
 * Continue ETH Deployment - Deploy Proxy only
 */
const { ethers, ContractFactory } = require("ethers");
const fs = require("fs");
const path = require("path");
const { vars } = require("hardhat/config");

const privateKey = vars.get("PRODUCT_KEY");
const feeVault = "0x831C1B82a8f5D538990759432Ea95417F2D19f02";
const feeRate = 20;

// Already deployed contracts
const implAddress = "0xB647e98E40855c9df7fC76281837C3Ed0C6b22ef";
const factoryImplAddress = "0xde07B19Bbc4EBa05C569F21aA9Bc87214F5b1D84";

// Use alternative RPC
const ETH_RPC = "https://ethereum-rpc.publicnode.com";

async function main() {
    const provider = new ethers.JsonRpcProvider(ETH_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log("Continuing ETH Mainnet Deployment...");
    console.log("Deployer:", wallet.address);

    const balance = await provider.getBalance(wallet.address);
    console.log("Balance:", ethers.formatEther(balance), "ETH\n");

    // Load proxy artifact
    const baseDir = path.join(__dirname, "../..");
    const proxyArtifactPath = path.join(baseDir, "artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json");
    const proxyArtifact = JSON.parse(fs.readFileSync(proxyArtifactPath));

    const factoryArtifactPath = path.join(baseDir, "artifacts/contracts/PayTheFlyProFactory.sol/PayTheFlyProFactory.json");
    const factoryArtifact = JSON.parse(fs.readFileSync(factoryArtifactPath));

    // Prepare initialize calldata
    console.log("Preparing initialize calldata...");
    const factoryInterface = new ethers.Interface(factoryArtifact.abi);
    const initData = factoryInterface.encodeFunctionData("initialize", [
        implAddress,
        feeVault,
        feeRate
    ]);
    console.log("Init data:", initData.slice(0, 66) + "...\n");

    // Get fee data
    const feeData = await provider.getFeeData();
    console.log("Gas Price:", ethers.formatUnits(feeData.gasPrice, "gwei"), "gwei\n");

    // Deploy ERC1967Proxy
    console.log("Deploying ERC1967Proxy...");
    const factory = new ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, wallet);
    const deployTx = await factory.getDeployTransaction(factoryImplAddress, initData);

    const tx = await wallet.sendTransaction({
        data: deployTx.data,
        gasLimit: 500000,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
    });

    console.log("TX:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("Confirmed in block:", receipt.blockNumber);
    console.log("Contract:", receipt.contractAddress);
    console.log("Gas Used:", receipt.gasUsed.toString());

    const proxyAddress = receipt.contractAddress;

    // Verify deployment
    console.log("\nVerifying deployment...");
    const factoryContract = new ethers.Contract(proxyAddress, factoryArtifact.abi, provider);

    const owner = await factoryContract.owner();
    const storedFeeVault = await factoryContract.feeVault();
    const storedFeeRate = await factoryContract.feeRate();
    const beaconAddress = await factoryContract.beacon();

    console.log("Owner:", owner);
    console.log("Fee Vault:", storedFeeVault);
    console.log("Fee Rate:", storedFeeRate.toString());
    console.log("Beacon:", beaconAddress);

    // Summary
    console.log("\n========================================");
    console.log("ETH Mainnet Deployment Complete!");
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

    const outputPath = path.join(__dirname, "deployment-eth.json");
    fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
    console.log("\nSaved to:", outputPath);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error:", error);
        process.exit(1);
    });

/**
 * Upgrade PayTheFlyPro contracts on BSC Mainnet using raw JSON-RPC
 * Avoids ethers.js parsing issues completely
 *
 * Usage:
 *   npx hardhat run scripts/deploy/upgradeBSCMainnetRaw.js --network bsc
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYMENT_FILE = path.join(__dirname, "deployment-bsc.json");

// Direct JSON-RPC call wrapper
async function rpcCall(provider, method, params) {
    return provider.send(method, params);
}

// Wait for transaction receipt using raw RPC
async function waitForReceipt(provider, txHash, maxAttempts = 120) {
    console.log("    Waiting for confirmation...");
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const receipt = await rpcCall(provider, "eth_getTransactionReceipt", [txHash]);
            if (receipt && receipt.blockNumber) {
                return {
                    status: parseInt(receipt.status, 16),
                    blockNumber: parseInt(receipt.blockNumber, 16),
                    contractAddress: receipt.contractAddress,
                    gasUsed: parseInt(receipt.gasUsed, 16)
                };
            }
        } catch (e) {
            // Ignore, retry
        }
        await new Promise(r => setTimeout(r, 3000));
        if (i % 10 === 9) {
            console.log(`    Still waiting... (${i + 1} attempts)`);
        }
    }
    throw new Error("Transaction not confirmed after max attempts");
}

// Get current nonce
async function getNonce(provider, address) {
    const result = await rpcCall(provider, "eth_getTransactionCount", [address, "pending"]);
    return parseInt(result, 16);
}

// Get gas price
async function getGasPrice(provider) {
    const result = await rpcCall(provider, "eth_gasPrice", []);
    return BigInt(result);
}

// Send raw transaction
async function sendRawTx(provider, signedTx) {
    return rpcCall(provider, "eth_sendRawTransaction", [signedTx]);
}

// Sign and send transaction using wallet
async function signAndSend(wallet, provider, txParams) {
    // Create serialized unsigned transaction
    const tx = ethers.Transaction.from({
        type: 0, // Legacy transaction
        to: txParams.to || null,
        data: txParams.data,
        gasLimit: txParams.gasLimit,
        gasPrice: txParams.gasPrice,
        nonce: txParams.nonce,
        chainId: txParams.chainId,
        value: txParams.value || 0n
    });

    // Get private key from wallet for signing
    // Note: Hardhat signers don't expose private key directly
    // We need to use the underlying provider's signing capability

    // Use eth_signTransaction instead
    const from = await wallet.getAddress();

    const txRequest = {
        from: from,
        to: txParams.to || undefined,
        data: txParams.data,
        gas: "0x" + txParams.gasLimit.toString(16),
        gasPrice: "0x" + txParams.gasPrice.toString(16),
        nonce: "0x" + txParams.nonce.toString(16),
        chainId: "0x" + txParams.chainId.toString(16),
        value: "0x0"
    };

    // Use Hardhat's internal signing
    const txHash = await rpcCall(provider, "eth_sendTransaction", [txRequest]);
    return txHash;
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const provider = ethers.provider;
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("========================================");
    console.log("PayTheFlyPro Raw RPC Upgrade - BSC Mainnet");
    console.log("========================================");
    console.log("Network:", network.name, `(chainId: ${chainId})`);
    console.log("Deployer:", deployer.address);

    const balance = await provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(balance), "BNB");
    console.log("========================================\n");

    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));

    console.log("Current Deployment:");
    console.log("  Factory Proxy:", deployment.contracts.factoryProxy);
    console.log("  Factory Impl:", deployment.contracts.factoryImpl);
    console.log("  Beacon:", deployment.contracts.beacon);
    console.log("  PayTheFlyPro Impl:", deployment.contracts.payTheFlyProImpl);
    console.log("");

    const gasPrice = await getGasPrice(provider);
    console.log("Gas Price:", ethers.formatUnits(gasPrice, "gwei"), "gwei\n");

    // Step 1: Deploy new Factory implementation
    console.log("Step 1: Deploying new PayTheFlyProFactory Implementation...");
    const PayTheFlyProFactory = await ethers.getContractFactory("PayTheFlyProFactory");

    const nonce1 = await getNonce(provider, deployer.address);
    const txHash1 = await signAndSend(deployer, provider, {
        data: PayTheFlyProFactory.bytecode,
        gasLimit: 2500000n,
        gasPrice: gasPrice,
        nonce: nonce1,
        chainId: chainId
    });
    console.log("  TX:", txHash1);

    const receipt1 = await waitForReceipt(provider, txHash1);
    if (receipt1.status !== 1) {
        throw new Error("Factory deployment failed");
    }
    const newFactoryImplAddress = receipt1.contractAddress;
    console.log("  New Factory Impl:", newFactoryImplAddress);
    console.log("  Block:", receipt1.blockNumber);
    console.log("  Gas Used:", receipt1.gasUsed);
    console.log("");

    // Step 2: Upgrade Factory proxy
    console.log("Step 2: Upgrading Factory Proxy...");
    const upgradeIface = new ethers.Interface([
        "function upgradeToAndCall(address newImplementation, bytes calldata data)"
    ]);
    const upgradeData = upgradeIface.encodeFunctionData("upgradeToAndCall", [newFactoryImplAddress, "0x"]);

    const nonce2 = await getNonce(provider, deployer.address);
    const txHash2 = await signAndSend(deployer, provider, {
        to: deployment.contracts.factoryProxy,
        data: upgradeData,
        gasLimit: 150000n,
        gasPrice: gasPrice,
        nonce: nonce2,
        chainId: chainId
    });
    console.log("  TX:", txHash2);

    const receipt2 = await waitForReceipt(provider, txHash2);
    if (receipt2.status !== 1) {
        throw new Error("Factory upgrade failed");
    }
    console.log("  Block:", receipt2.blockNumber);
    console.log("  Gas Used:", receipt2.gasUsed);
    console.log("");

    // Step 3: Verify Factory upgrade
    console.log("Step 3: Verifying Factory Upgrade...");
    const factoryAbi = ["function withdrawalFee() view returns (uint256)"];
    const factory = new ethers.Contract(deployment.contracts.factoryProxy, factoryAbi, provider);
    const withdrawalFee = await factory.withdrawalFee();
    console.log("  withdrawalFee():", withdrawalFee.toString(), "✓");
    console.log("");

    // Step 4: Deploy new PayTheFlyPro implementation
    console.log("Step 4: Deploying new PayTheFlyPro Implementation...");
    const PayTheFlyPro = await ethers.getContractFactory("PayTheFlyPro");

    const nonce3 = await getNonce(provider, deployer.address);
    const txHash3 = await signAndSend(deployer, provider, {
        data: PayTheFlyPro.bytecode,
        gasLimit: 5500000n,
        gasPrice: gasPrice,
        nonce: nonce3,
        chainId: chainId
    });
    console.log("  TX:", txHash3);

    const receipt3 = await waitForReceipt(provider, txHash3);
    if (receipt3.status !== 1) {
        throw new Error("PayTheFlyPro deployment failed");
    }
    const newPayTheFlyProImplAddress = receipt3.contractAddress;
    console.log("  New PayTheFlyPro Impl:", newPayTheFlyProImplAddress);
    console.log("  Block:", receipt3.blockNumber);
    console.log("  Gas Used:", receipt3.gasUsed);
    console.log("");

    // Step 5: Upgrade Beacon
    console.log("Step 5: Upgrading Beacon Implementation...");
    const beaconIface = new ethers.Interface([
        "function upgradeBeacon(address newImplementation)"
    ]);
    const beaconUpgradeData = beaconIface.encodeFunctionData("upgradeBeacon", [newPayTheFlyProImplAddress]);

    const nonce4 = await getNonce(provider, deployer.address);
    const txHash4 = await signAndSend(deployer, provider, {
        to: deployment.contracts.factoryProxy,
        data: beaconUpgradeData,
        gasLimit: 150000n,
        gasPrice: gasPrice,
        nonce: nonce4,
        chainId: chainId
    });
    console.log("  TX:", txHash4);

    const receipt4 = await waitForReceipt(provider, txHash4);
    if (receipt4.status !== 1) {
        throw new Error("Beacon upgrade failed");
    }
    console.log("  Block:", receipt4.blockNumber);
    console.log("  Gas Used:", receipt4.gasUsed);
    console.log("");

    // Verify beacon
    console.log("Step 6: Verifying Beacon Upgrade...");
    const beaconAbi = ["function implementation() view returns (address)"];
    const beacon = new ethers.Contract(deployment.contracts.beacon, beaconAbi, provider);
    const currentBeaconImpl = await beacon.implementation();
    console.log("  Beacon implementation:", currentBeaconImpl);
    if (currentBeaconImpl.toLowerCase() === newPayTheFlyProImplAddress.toLowerCase()) {
        console.log("  ✓ Beacon upgrade verified!");
    } else {
        console.log("  ⚠ Beacon implementation mismatch!");
    }
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
                type: "security-fix-removed-admin-confirmation",
                oldFactoryImpl: deployment.contracts.factoryImpl,
                newFactoryImpl: newFactoryImplAddress,
                oldPayTheFlyProImpl: deployment.contracts.payTheFlyProImpl,
                newPayTheFlyProImpl: newPayTheFlyProImplAddress
            }
        ]
    };

    fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(updatedDeployment, null, 2));
    console.log("Deployment info updated!");

    console.log("\n========================================");
    console.log("Upgrade Summary - BSC Mainnet");
    console.log("========================================");
    console.log("Factory Proxy:", deployment.contracts.factoryProxy);
    console.log("  - Old Impl:", deployment.contracts.factoryImpl);
    console.log("  - New Impl:", newFactoryImplAddress);
    console.log("Beacon:", deployment.contracts.beacon);
    console.log("  - Old Impl:", deployment.contracts.payTheFlyProImpl);
    console.log("  - New Impl:", newPayTheFlyProImplAddress);
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Upgrade failed:", error);
        process.exit(1);
    });

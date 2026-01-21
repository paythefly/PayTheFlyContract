/**
 * Deploy PayTheFlyProFactory on TRON (TVM) with UUPS Proxy
 *
 * Usage:
 *   TRON_PRIVATE_KEY=xxx TRON_NETWORK=local FEE_VAULT=Txxx node scripts/deploy/tron/deployFactory.js
 *   TRON_PRIVATE_KEY=xxx TRON_NETWORK=shasta FEE_VAULT=Txxx node scripts/deploy/tron/deployFactory.js
 *
 * Or with Hardhat vars:
 *   npx hardhat run scripts/deploy/tron/deployFactory.js --network tronLocal
 *
 * Environment Variables:
 *   TRON_PRIVATE_KEY - Private key for deployment (or use hardhat vars)
 *   TRON_NETWORK - Network name (local, shasta, nile, mainnet)
 *   FEE_VAULT - Fee vault address (TRON format)
 *   FEE_RATE - Fee rate in basis points (default: 100 = 1%)
 */

const { TronWeb } = require("tronweb");
const fs = require("fs");
const path = require("path");

// Try to load hardhat vars
let hardhatVars = null;
try {
    const { vars } = require("hardhat/config");
    hardhatVars = vars;
} catch (e) {
    // Running without hardhat
}

// Network configurations
const NETWORKS = {
    local: {
        fullHost: "http://127.0.0.1:9090",
        solidityNode: "http://127.0.0.1:9090",
        eventServer: "http://127.0.0.1:9090",
        name: "Local TRE",
        keyName: "TRE_LOCAL_TRON_DEVELOPMENT_KEY_1"
    },
    shasta: {
        fullHost: "https://api.shasta.trongrid.io",
        solidityNode: "https://api.shasta.trongrid.io",
        eventServer: "https://api.shasta.trongrid.io",
        name: "Shasta Testnet",
        keyName: "TRON_DEVELOPMENT_KEY"
    },
    nile: {
        fullHost: "https://nile.trongrid.io",
        solidityNode: "https://nile.trongrid.io",
        eventServer: "https://nile.trongrid.io",
        name: "Nile Testnet",
        keyName: "TRON_DEVELOPMENT_KEY"
    },
    mainnet: {
        fullHost: "https://api.trongrid.io",
        solidityNode: "https://api.trongrid.io",
        eventServer: "https://api.trongrid.io",
        name: "TRON Mainnet",
        keyName: "TRON_DEVELOPMENT_KEY"
    }
};

// Get private key from env or hardhat vars
function getPrivateKey(networkConfig) {
    // First try env variable
    if (process.env.TRON_PRIVATE_KEY) {
        return process.env.TRON_PRIVATE_KEY;
    }

    // Then try hardhat vars
    if (hardhatVars) {
        try {
            return hardhatVars.get(networkConfig.keyName);
        } catch (e) {
            // Key not found
        }
    }

    throw new Error(
        `Private key not found. Either:\n` +
        `  1. Set TRON_PRIVATE_KEY environment variable, or\n` +
        `  2. Set hardhat var: npx hardhat vars set ${networkConfig.keyName}`
    );
}

/**
 * Patch TronWeb for TRE compatibility
 * TRE quickstart doesn't support /wallet/getblock endpoint that TronWeb v6 uses
 * This patches the method to use /wallet/getnowblock instead
 */
function patchTronWebForTRE(tronWeb) {
    const originalGetCurrentRefBlockParams = tronWeb.trx.getCurrentRefBlockParams.bind(tronWeb.trx);

    tronWeb.trx.getCurrentRefBlockParams = async function() {
        try {
            // Try using getnowblock which TRE supports
            const block = await tronWeb.fullNode.request('wallet/getnowblock', {}, 'post');
            const { number, timestamp } = block.block_header.raw_data;
            return {
                ref_block_bytes: number.toString(16).slice(-4).padStart(4, '0'),
                ref_block_hash: block.blockID.slice(16, 32),
                expiration: timestamp + 60 * 1000,
                timestamp,
            };
        } catch (e) {
            // Fallback to original method for other networks
            return originalGetCurrentRefBlockParams();
        }
    };

    return tronWeb;
}

/**
 * Deploy a contract manually (build tx -> sign -> broadcast)
 * This is more compatible with TRE than tronWeb.contract().new()
 *
 * Note: For TRE compatibility, we deploy with empty ABI to reduce transaction size.
 * Full ABI is only needed when interacting with the contract, not for deployment.
 */
async function deployContract(tronWeb, abi, bytecode, parameters = [], feeLimit = 1000000000) {
    const ownerAddress = tronWeb.defaultAddress.hex;

    // Build constructor parameters if any
    let deployBytecode = bytecode;
    if (parameters.length > 0) {
        // Find constructor in ABI
        const constructorAbi = abi.find(item => item.type === 'constructor');
        if (constructorAbi && constructorAbi.inputs && constructorAbi.inputs.length > 0) {
            const types = constructorAbi.inputs.map(input => input.type);
            const encodedParams = tronWeb.utils.abi.encodeParams(types, parameters);
            deployBytecode = bytecode + encodedParams.slice(2);
        }
    }

    // Build transaction with empty ABI for TRE compatibility
    // Full ABI makes transaction too large, causing SIGERROR on TRE
    const tx = await tronWeb.transactionBuilder.createSmartContract({
        abi: [],  // Empty ABI for deployment
        bytecode: deployBytecode,
        feeLimit: feeLimit,
        callValue: 0,
        owner_address: ownerAddress
    });

    // Sign transaction
    const signedTx = await tronWeb.trx.sign(tx);

    // Broadcast transaction with retry for SERVER_BUSY
    let result;
    for (let i = 0; i < 3; i++) {
        result = await tronWeb.trx.sendRawTransaction(signedTx);
        if (result.result === true) break;
        if (result.code === 'SERVER_BUSY') {
            console.log('    Server busy, retrying in 5s...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
            break;
        }
    }

    if (!result.result) {
        throw new Error(`Deployment failed: ${JSON.stringify(result)}`);
    }

    // Wait for transaction confirmation
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get contract address from transaction result
    const contractAddress = result.transaction.contract_address || signedTx.contract_address;

    return {
        address: contractAddress,
        txId: result.transaction.txID
    };
}

// Default configuration for deployment
const DEFAULT_CONFIG = {
    local: { feeVault: "TVtiRNnzbrET6FndHBCLDxRBNid9LHMNjH", feeRate: 100 },
    shasta: { feeVault: "", feeRate: 100 },
    nile: { feeVault: "", feeRate: 100 },
    mainnet: { feeVault: "", feeRate: 100 }
};

async function main() {
    // Configuration - prefer env vars, fallback to defaults
    const networkName = process.env.TRON_NETWORK || "local";
    const defaultConfig = DEFAULT_CONFIG[networkName] || DEFAULT_CONFIG.local;
    const feeVault = process.env.FEE_VAULT || defaultConfig.feeVault;
    const feeRate = parseInt(process.env.FEE_RATE || defaultConfig.feeRate);

    const networkConfig = NETWORKS[networkName];
    if (!networkConfig) {
        throw new Error(`Unknown network: ${networkName}. Use: local, shasta, nile, or mainnet`);
    }

    const privateKey = getPrivateKey(networkConfig);

    if (!feeVault) {
        throw new Error("FEE_VAULT environment variable is required");
    }

    // Initialize TronWeb
    let tronWeb = new TronWeb({
        fullHost: networkConfig.fullHost,
        solidityNode: networkConfig.solidityNode,
        eventServer: networkConfig.eventServer,
        privateKey: privateKey
    });

    // Patch for TRE local network compatibility
    if (networkName === "local") {
        tronWeb = patchTronWebForTRE(tronWeb);
        console.log("Applied TRE compatibility patch for TronWeb v6\n");
    }

    const deployerAddress = tronWeb.address.fromPrivateKey(privateKey);
    const balance = await tronWeb.trx.getBalance(deployerAddress);

    console.log("========================================");
    console.log("PayTheFlyPro Factory Deployment (TRON)");
    console.log("========================================");
    console.log("Network:", networkConfig.name);
    console.log("Deployer:", deployerAddress);
    console.log("Balance:", tronWeb.fromSun(balance), "TRX");
    console.log("========================================\n");

    console.log("Configuration:");
    console.log("  Fee Vault:", feeVault);
    console.log("  Fee Rate:", feeRate, "basis points (", feeRate / 100, "%)");
    console.log("");

    // Load compiled contracts - prefer artifacts-tron for TRON deployment
    const baseDir = path.join(__dirname, "../../..");
    let artifactsPath = path.join(baseDir, "artifacts-tron/contracts");

    // Fallback to regular artifacts if tron artifacts don't exist
    if (!fs.existsSync(artifactsPath)) {
        artifactsPath = path.join(baseDir, "artifacts/contracts");
        console.log("Warning: Using EVM artifacts. Run 'npx hardhat compile --network tronLocal' for TRON-specific compilation.\n");
    }

    const payTheFlyProArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyPro.sol/PayTheFlyPro.json"))
    );
    const factoryArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyProFactory.sol/PayTheFlyProFactory.json"))
    );

    // Load ERC1967Proxy from OpenZeppelin artifacts
    let proxyArtifactPath = path.join(baseDir, "artifacts-tron/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json");
    if (!fs.existsSync(proxyArtifactPath)) {
        proxyArtifactPath = path.join(baseDir, "artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json");
    }
    const proxyArtifact = JSON.parse(fs.readFileSync(proxyArtifactPath));

    // Step 1: Deploy PayTheFlyPro implementation
    console.log("Step 1: Deploying PayTheFlyPro implementation...");
    const payTheFlyProResult = await deployContract(
        tronWeb,
        payTheFlyProArtifact.abi,
        payTheFlyProArtifact.bytecode
    );
    const implAddress = tronWeb.address.fromHex(payTheFlyProResult.address);
    console.log("  PayTheFlyPro Implementation:", implAddress);
    console.log("  TX:", payTheFlyProResult.txId);

    // Step 2: Deploy PayTheFlyProFactory implementation
    console.log("\nStep 2: Deploying PayTheFlyProFactory implementation...");
    const factoryImplResult = await deployContract(
        tronWeb,
        factoryArtifact.abi,
        factoryArtifact.bytecode
    );
    const factoryImplAddress = tronWeb.address.fromHex(factoryImplResult.address);
    console.log("  Factory Implementation:", factoryImplAddress);
    console.log("  TX:", factoryImplResult.txId);

    // Step 3: Deploy ERC1967Proxy for Factory with initialize calldata
    console.log("\nStep 3: Deploying ERC1967Proxy for Factory...");

    // Encode initialize function call using TronWeb
    const initializeSelector = tronWeb.sha3("initialize(address,address,uint256)").slice(0, 10);
    const encodedParams = tronWeb.utils.abi.encodeParams(
        ["address", "address", "uint256"],
        [
            tronWeb.address.toHex(implAddress).replace(/^41/, "0x"),
            tronWeb.address.toHex(feeVault).replace(/^41/, "0x"),
            feeRate
        ]
    );
    const initData = initializeSelector + encodedParams.slice(2);

    const proxyResult = await deployContract(
        tronWeb,
        proxyArtifact.abi,
        proxyArtifact.bytecode,
        [
            tronWeb.address.toHex(factoryImplAddress),
            initData
        ]
    );
    const factoryProxyAddress = tronWeb.address.fromHex(proxyResult.address);
    console.log("  Factory Proxy:", factoryProxyAddress);
    console.log("  TX:", proxyResult.txId);

    // Step 4: Verify deployment
    console.log("\nStep 4: Verifying deployment...");
    console.log("  Waiting for contract confirmation...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    let owner, storedFeeVault, storedFeeRate, beaconAddress;

    // Retry verification with delays (contracts may take time to be queryable)
    for (let i = 0; i < 5; i++) {
        try {
            const factory = await tronWeb.contract(factoryArtifact.abi, proxyResult.address);
            owner = await factory.owner().call();
            storedFeeVault = await factory.feeVault().call();
            storedFeeRate = await factory.feeRate().call();
            beaconAddress = await factory.beacon().call();
            break;
        } catch (e) {
            if (i < 4) {
                console.log(`  Verification attempt ${i + 1} failed, retrying in 5s...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                console.log("  Warning: Could not verify contract state. Contract may still be confirming.");
                console.log("  You can verify manually using the contract addresses below.");
                owner = null;
            }
        }
    }

    if (owner) {
        console.log("  Owner:", tronWeb.address.fromHex(owner));
        console.log("  Fee Vault:", tronWeb.address.fromHex(storedFeeVault));
        console.log("  Fee Rate:", storedFeeRate.toString());
        console.log("  Beacon:", tronWeb.address.fromHex(beaconAddress));

        // Verify values are correct
        const expectedOwner = deployerAddress;
        const actualOwner = tronWeb.address.fromHex(owner);
        if (actualOwner !== expectedOwner) {
            console.log("\n⚠️  Warning: Owner mismatch!");
            console.log("  Expected:", expectedOwner);
            console.log("  Actual:", actualOwner);
        }
    }

    // Summary
    console.log("\n========================================");
    console.log("Deployment Summary (TRON)");
    console.log("========================================");
    console.log("PayTheFlyPro Implementation:", implAddress);
    console.log("PayTheFlyProFactory Implementation:", factoryImplAddress);
    console.log("PayTheFlyProFactory Proxy:", factoryProxyAddress);
    if (beaconAddress) {
        console.log("Beacon:", tronWeb.address.fromHex(beaconAddress));
    } else {
        console.log("Beacon: (pending verification)");
    }
    console.log("========================================");

    // Save deployment info
    const deploymentInfo = {
        network: networkName,
        networkName: networkConfig.name,
        deployer: deployerAddress,
        timestamp: new Date().toISOString(),
        contracts: {
            payTheFlyProImpl: implAddress,
            factoryImpl: factoryImplAddress,
            factoryProxy: factoryProxyAddress,
            beacon: beaconAddress ? tronWeb.address.fromHex(beaconAddress) : "(pending)"
        },
        config: {
            feeVault: feeVault,
            feeRate: feeRate
        }
    };

    console.log("\nDeployment Info (JSON):");
    console.log(JSON.stringify(deploymentInfo, null, 2));

    // Save to file
    const outputPath = path.join(__dirname, `deployment-${networkName}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`\nDeployment info saved to: ${outputPath}`);

    return deploymentInfo;
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });

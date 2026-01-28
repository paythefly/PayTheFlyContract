/**
 * Set withdrawal fee on TRON
 * Usage:
 *   TRON_NETWORK=nile FEE=0.001 npx hardhat run scripts/deploy/tron/setWithdrawalFee.js
 *   TRON_NETWORK=mainnet FEE=0.001 npx hardhat run scripts/deploy/tron/setWithdrawalFee.js
 *
 * TRX decimal is 6 (1 TRX = 1,000,000 sun)
 */

const { TronWeb } = require("tronweb");
const fs = require("fs");
const path = require("path");

let hardhatVars = null;
try {
    const { vars } = require("hardhat/config");
    hardhatVars = vars;
} catch (e) {}

const NETWORKS = {
    nile: {
        fullHost: "https://nile.trongrid.io",
        name: "Nile Testnet",
        keyName: "TRON_DEVELOPMENT_KEY"
    },
    mainnet: {
        fullHost: "https://api.trongrid.io",
        name: "TRON Mainnet",
        keyName: "TRON_DEVELOPMENT_KEY"
    }
};

async function main() {
    const networkName = process.env.TRON_NETWORK || "nile";
    const feeInTRX = process.env.FEE || "0.001";

    const networkConfig = NETWORKS[networkName];
    if (!networkConfig) {
        throw new Error(`Unknown network: ${networkName}`);
    }

    // Load deployment info
    const deploymentPath = path.join(__dirname, `deployment-${networkName}.json`);
    if (!fs.existsSync(deploymentPath)) {
        throw new Error(`Deployment file not found: ${deploymentPath}`);
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentPath));

    const privateKey = hardhatVars.get(networkConfig.keyName);

    const tronWeb = new TronWeb({
        fullHost: networkConfig.fullHost,
        privateKey: privateKey
    });

    const deployerAddress = tronWeb.address.fromPrivateKey(privateKey);

    console.log("========================================");
    console.log("Set Withdrawal Fee - TRON", networkConfig.name);
    console.log("========================================");
    console.log("Deployer:", deployerAddress);
    console.log("Factory:", deployment.contracts.factoryProxy);
    console.log("");

    // TRX decimal is 6, convert to sun
    // 0.001 TRX = 0.001 * 10^6 sun = 1000 sun
    const feeInSun = BigInt(Math.floor(parseFloat(feeInTRX) * 1_000_000));
    console.log("Setting withdrawal fee to:", feeInTRX, "TRX");
    console.log("Fee in sun:", feeInSun.toString());

    // Load Factory ABI
    const baseDir = path.join(__dirname, "../../..");
    let artifactsPath = path.join(baseDir, "artifacts-tron/contracts");
    if (!fs.existsSync(artifactsPath)) {
        artifactsPath = path.join(baseDir, "artifacts/contracts");
    }
    const factoryArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyProFactory.sol/PayTheFlyProFactory.json"))
    );

    // Use triggerSmartContract for setWithdrawalFee
    const factoryAddress = deployment.contracts.factoryProxy;

    console.log("\nSending transaction...");
    const tx = await tronWeb.transactionBuilder.triggerSmartContract(
        factoryAddress,
        "setWithdrawalFee(uint256)",
        {
            feeLimit: 50000000,
            callValue: 0
        },
        [{ type: "uint256", value: feeInSun.toString() }],
        deployerAddress
    );

    const signedTx = await tronWeb.trx.sign(tx.transaction);
    const result = await tronWeb.trx.sendRawTransaction(signedTx);

    if (!result.result) {
        throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
    }
    console.log("TX:", result.transaction.txID);

    // Wait for confirmation
    console.log("\nWaiting for confirmation (10s)...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Verify using triggerConstantContract
    const feeResult = await tronWeb.transactionBuilder.triggerConstantContract(
        factoryAddress,
        "withdrawalFee()",
        {},
        [],
        deployerAddress
    );

    const currentFee = feeResult.constant_result[0];
    const feeValue = parseInt(currentFee, 16);
    console.log("\nCurrent withdrawal fee:", feeValue, "sun");
    console.log("                       =", feeValue / 1_000_000, "TRX");

    console.log("\n========================================");
    console.log("Withdrawal fee set successfully!");
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Failed:", error);
        process.exit(1);
    });

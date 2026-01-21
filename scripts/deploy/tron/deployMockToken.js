/**
 * Deploy MockERC20 token on TRON for testing
 *
 * Usage:
 *   npx hardhat run scripts/deploy/tron/deployMockToken.js --network tronLocal
 *
 * Environment Variables (optional):
 *   TOKEN_NAME - Token name (default: "Mock USDT")
 *   TOKEN_SYMBOL - Token symbol (default: "MUSDT")
 *   TOKEN_DECIMALS - Token decimals (default: 6)
 *   MINT_AMOUNT - Initial mint amount (default: 1000000)
 */

const { TronWeb } = require("tronweb");
const fs = require("fs");
const path = require("path");

// Try to load hardhat config
let hre, hardhatVars;
try {
    hre = require("hardhat");
    const { vars } = require("hardhat/config");
    hardhatVars = vars;
} catch (e) {}

const NETWORKS = {
    tronLocal: { fullHost: "http://127.0.0.1:9090", name: "Local TRE", keyName: "TRE_LOCAL_TRON_DEVELOPMENT_KEY_1" },
    local: { fullHost: "http://127.0.0.1:9090", name: "Local TRE", keyName: "TRE_LOCAL_TRON_DEVELOPMENT_KEY_1" },
    tronShasta: { fullHost: "https://api.shasta.trongrid.io", name: "Shasta Testnet", keyName: "TRON_DEVELOPMENT_KEY" },
    shasta: { fullHost: "https://api.shasta.trongrid.io", name: "Shasta Testnet", keyName: "TRON_DEVELOPMENT_KEY" },
    tronNile: { fullHost: "https://nile.trongrid.io", name: "Nile Testnet", keyName: "TRON_DEVELOPMENT_KEY" },
    nile: { fullHost: "https://nile.trongrid.io", name: "Nile Testnet", keyName: "TRON_DEVELOPMENT_KEY" },
    tronMainnet: { fullHost: "https://api.trongrid.io", name: "TRON Mainnet", keyName: "TRON_DEVELOPMENT_KEY" },
    mainnet: { fullHost: "https://api.trongrid.io", name: "TRON Mainnet", keyName: "TRON_DEVELOPMENT_KEY" }
};

function getPrivateKey(networkConfig) {
    if (process.env.TRON_PRIVATE_KEY) return process.env.TRON_PRIVATE_KEY;
    if (hardhatVars) {
        try { return hardhatVars.get(networkConfig.keyName); } catch (e) {}
    }
    throw new Error(`Private key not found. Set TRON_PRIVATE_KEY or hardhat var ${networkConfig.keyName}`);
}

async function main() {
    // Determine network from hardhat or env
    let networkName = process.env.TRON_NETWORK || "local";
    if (hre && hre.network && hre.network.name) {
        networkName = hre.network.name;
    }

    const networkConfig = NETWORKS[networkName];
    if (!networkConfig) throw new Error(`Unknown network: ${networkName}`);

    const privateKey = getPrivateKey(networkConfig);

    // Token config
    const tokenName = process.env.TOKEN_NAME || "Mock USDT";
    const tokenSymbol = process.env.TOKEN_SYMBOL || "MUSDT";
    const tokenDecimals = parseInt(process.env.TOKEN_DECIMALS || "6");
    const mintAmount = process.env.MINT_AMOUNT || "1000000"; // 1M tokens

    const tronWeb = new TronWeb({
        fullHost: networkConfig.fullHost,
        privateKey: privateKey
    });

    const deployerAddress = tronWeb.address.fromPrivateKey(privateKey);
    const balance = await tronWeb.trx.getBalance(deployerAddress);

    console.log("========================================");
    console.log("Deploy Mock ERC20 Token (TRON)");
    console.log("========================================");
    console.log("Network:", networkConfig.name);
    console.log("Deployer:", deployerAddress);
    console.log("Balance:", tronWeb.fromSun(balance), "TRX");
    console.log("========================================\n");

    console.log("Token Configuration:");
    console.log("  Name:", tokenName);
    console.log("  Symbol:", tokenSymbol);
    console.log("  Decimals:", tokenDecimals);
    console.log("  Initial Mint:", mintAmount, tokenSymbol);
    console.log("");

    // Load MockERC20 artifact
    const baseDir = path.join(__dirname, "../../..");
    let artifactsPath = path.join(baseDir, "artifacts-tron/contracts");
    if (!fs.existsSync(artifactsPath)) {
        artifactsPath = path.join(baseDir, "artifacts/contracts");
    }

    const mockTokenArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "mock/MockERC20.sol/MockERC20.json"))
    );

    // Deploy MockERC20
    console.log("Deploying MockERC20...");
    const tokenContract = await tronWeb.contract().new({
        abi: mockTokenArtifact.abi,
        bytecode: mockTokenArtifact.bytecode,
        feeLimit: 500000000, // 500 TRX
        callValue: 0,
        parameters: [tokenName, tokenSymbol, tokenDecimals]
    });

    const tokenAddress = tronWeb.address.fromHex(tokenContract.address);
    console.log("  Token Address:", tokenAddress);

    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get token contract instance
    const token = await tronWeb.contract(mockTokenArtifact.abi, tokenContract.address);

    // Mint tokens to deployer
    console.log("\nMinting tokens to deployer...");
    const mintAmountWei = BigInt(mintAmount) * BigInt(10 ** tokenDecimals);
    const mintTx = await token.mint(
        tronWeb.address.toHex(deployerAddress),
        mintAmountWei.toString()
    ).send({
        feeLimit: 100000000
    });
    console.log("  Mint TX:", mintTx);

    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify
    console.log("\nVerifying deployment...");
    const name = await token.name().call();
    const symbol = await token.symbol().call();
    const decimals = await token.decimals().call();
    const totalSupply = await token.totalSupply().call();
    const deployerBalance = await token.balanceOf(tronWeb.address.toHex(deployerAddress)).call();

    console.log("  Name:", name);
    console.log("  Symbol:", symbol);
    console.log("  Decimals:", decimals.toString());
    console.log("  Total Supply:", (BigInt(totalSupply) / BigInt(10 ** tokenDecimals)).toString(), symbol);
    console.log("  Deployer Balance:", (BigInt(deployerBalance) / BigInt(10 ** tokenDecimals)).toString(), symbol);

    // Summary
    console.log("\n========================================");
    console.log("Deployment Summary");
    console.log("========================================");
    console.log("Token Address:", tokenAddress);
    console.log("Token Address (Hex):", tokenContract.address);
    console.log("========================================");

    // Save deployment info
    const deploymentInfo = {
        network: networkName,
        timestamp: new Date().toISOString(),
        token: {
            address: tokenAddress,
            addressHex: tokenContract.address,
            name: tokenName,
            symbol: tokenSymbol,
            decimals: tokenDecimals
        },
        deployer: deployerAddress
    };

    const outputPath = path.join(__dirname, `mock-token-${networkName}.json`);
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

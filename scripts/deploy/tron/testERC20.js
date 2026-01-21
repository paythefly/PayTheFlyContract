/**
 * Test ERC20 token operations on TRON
 *
 * Usage:
 *   npx hardhat run scripts/deploy/tron/testERC20.js --network tronLocal
 *
 * Environment Variables:
 *   TOKEN - Token address (or reads from mock-token-local.json)
 *   PROJECT - Project address (or reads from deployment-local.json)
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
} catch (e) {
    // Running without hardhat
}

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

    // Try to load addresses from deployment files
    const baseDir = path.join(__dirname, "../../..");
    let tokenAddress = process.env.TOKEN;
    let projectAddress = process.env.PROJECT;

    // Load from mock-token file if not provided
    if (!tokenAddress) {
        const tokenFile = path.join(__dirname, "mock-token-local.json");
        if (fs.existsSync(tokenFile)) {
            const data = JSON.parse(fs.readFileSync(tokenFile));
            tokenAddress = data.token.address;
        }
    }

    // Load from deployment file if not provided
    if (!projectAddress) {
        const deployFile = path.join(__dirname, "deployment-local.json");
        if (fs.existsSync(deployFile)) {
            const data = JSON.parse(fs.readFileSync(deployFile));
            // Try to get project from a projects file or use factory for now
            // For testing, we need a project address explicitly
        }
    }

    if (!tokenAddress) throw new Error("TOKEN address required (set TOKEN env or deploy mock token first)");
    if (!projectAddress) throw new Error("PROJECT address required (set PROJECT env)");

    const tronWeb = new TronWeb({
        fullHost: networkConfig.fullHost,
        privateKey: privateKey
    });

    const userAddress = tronWeb.address.fromPrivateKey(privateKey);

    console.log("========================================");
    console.log("ERC20 Token Test (TRON)");
    console.log("========================================");
    console.log("Network:", networkConfig.name);
    console.log("User:", userAddress);
    console.log("Token:", tokenAddress);
    console.log("Project:", projectAddress);
    console.log("========================================\n");

    // Load artifacts
    let artifactsPath = path.join(baseDir, "artifacts-tron/contracts");
    if (!fs.existsSync(artifactsPath)) {
        artifactsPath = path.join(baseDir, "artifacts/contracts");
    }

    const tokenArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "mock/MockERC20.sol/MockERC20.json"))
    );
    const projectArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyPro.sol/PayTheFlyPro.json"))
    );

    const token = await tronWeb.contract(tokenArtifact.abi, tokenAddress);
    const project = await tronWeb.contract(projectArtifact.abi, projectAddress);

    let passed = 0;
    let failed = 0;

    // Helper to format token amounts
    const decimals = parseInt((await token.decimals().call()).toString());
    const formatAmount = (amount) => {
        const val = BigInt(amount.toString());
        return (val / BigInt(10 ** decimals)).toString();
    };

    // Test 1: Check token info
    console.log("Test 1: Token Info");
    try {
        const name = await token.name().call();
        const symbol = await token.symbol().call();
        const userBalance = await token.balanceOf(tronWeb.address.toHex(userAddress)).call();
        console.log("  ✅ Name:", name);
        console.log("     Symbol:", symbol);
        console.log("     Decimals:", decimals);
        console.log("     User Balance:", formatAmount(userBalance), symbol);
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Test 2: Check project token balance (should be 0)
    console.log("\nTest 2: Project Token Balance (initial)");
    try {
        const result = await project.getBalance(tronWeb.address.toHex(tokenAddress)).call();
        // TronWeb may return array or single value
        const projectBalance = Array.isArray(result) ? result[0] : result;
        console.log("  ✅ Project Token Balance:", formatAmount(projectBalance));
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Test 3: Approve tokens to project
    console.log("\nTest 3: Approve tokens to Project");
    try {
        const approveAmount = BigInt(100) * BigInt(10 ** decimals); // 100 tokens
        const tx = await token.approve(
            tronWeb.address.toHex(projectAddress),
            approveAmount.toString()
        ).send({ feeLimit: 100000000 });
        console.log("  ✅ Approve TX:", tx);

        await new Promise(resolve => setTimeout(resolve, 2000));

        const allowance = await token.allowance(
            tronWeb.address.toHex(userAddress),
            tronWeb.address.toHex(projectAddress)
        ).call();
        console.log("     Allowance:", formatAmount(allowance));
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Test 4: Deposit tokens to withdrawal pool
    console.log("\nTest 4: Deposit tokens to Project withdrawal pool");
    try {
        const depositAmount = BigInt(50) * BigInt(10 ** decimals); // 50 tokens
        const tx = await project.depositToWithdrawalPool(
            tronWeb.address.toHex(tokenAddress),
            depositAmount.toString()
        ).send({ feeLimit: 200000000 });
        console.log("  ✅ Deposit TX:", tx);

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check balances
        const projectBalanceResult = await project.getBalance(tronWeb.address.toHex(tokenAddress)).call();
        const projectBalance = Array.isArray(projectBalanceResult) ? projectBalanceResult[0] : projectBalanceResult;
        const userBalance = await token.balanceOf(tronWeb.address.toHex(userAddress)).call();
        console.log("     Project Token Balance:", formatAmount(projectBalance));
        console.log("     User Token Balance:", formatAmount(userBalance));
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Test 5: Check batch balances (use individual queries for reliability)
    console.log("\nTest 5: Balance Query");
    try {
        const trxResult = await project.getBalance("0x0000000000000000000000000000000000000000").call();
        const trxBalance = Array.isArray(trxResult) ? trxResult[0] : trxResult;
        const tokenResult = await project.getBalance(tronWeb.address.toHex(tokenAddress)).call();
        const tokenBalance = Array.isArray(tokenResult) ? tokenResult[0] : tokenResult;
        console.log("  ✅ TRX Balance:", tronWeb.fromSun(trxBalance.toString()), "TRX");
        console.log("     Token Balance:", formatAmount(tokenBalance));
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Test 6: Transfer tokens directly to project (simulating payment without signature)
    console.log("\nTest 6: Direct token transfer to Project");
    try {
        const transferAmount = BigInt(10) * BigInt(10 ** decimals); // 10 tokens
        const tx = await token.transfer(
            tronWeb.address.toHex(projectAddress),
            transferAmount.toString()
        ).send({ feeLimit: 100000000 });
        console.log("  ✅ Transfer TX:", tx);

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Note: Direct transfer doesn't update project's internal balance tracking
        // This is expected behavior - payments should go through pay() function
        const tokenBalance = await token.balanceOf(tronWeb.address.toHex(projectAddress)).call();
        const projectTrackedResult = await project.getBalance(tronWeb.address.toHex(tokenAddress)).call();
        const projectTrackedBalance = Array.isArray(projectTrackedResult) ? projectTrackedResult[0] : projectTrackedResult;
        console.log("     Actual Token Balance (on contract):", formatAmount(tokenBalance));
        console.log("     Tracked Balance (in project):", formatAmount(projectTrackedBalance));
        console.log("     ⚠️  Note: Direct transfers bypass internal tracking");
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Summary
    console.log("\n========================================");
    console.log("Test Summary");
    console.log("========================================");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);
    console.log("========================================");

    if (failed > 0) process.exit(1);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Test failed:", error);
        process.exit(1);
    });

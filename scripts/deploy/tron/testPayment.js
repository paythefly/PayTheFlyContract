/**
 * Test basic functionality on TRON
 *
 * Usage:
 *   TRON_PRIVATE_KEY=xxx TRON_NETWORK=local PROJECT=Txxx node scripts/deploy/tron/testPayment.js
 */

const { TronWeb } = require("tronweb");
const fs = require("fs");
const path = require("path");

// Network configurations
const NETWORKS = {
    local: {
        fullHost: "http://127.0.0.1:9090",
        name: "Local TRE"
    },
    shasta: {
        fullHost: "https://api.shasta.trongrid.io",
        name: "Shasta Testnet"
    },
    nile: {
        fullHost: "https://nile.trongrid.io",
        name: "Nile Testnet"
    },
    mainnet: {
        fullHost: "https://api.trongrid.io",
        name: "TRON Mainnet"
    }
};

async function main() {
    const privateKey = process.env.TRON_PRIVATE_KEY;
    const networkName = process.env.TRON_NETWORK || "local";
    const projectAddress = process.env.PROJECT;

    if (!privateKey) {
        throw new Error("TRON_PRIVATE_KEY environment variable is required");
    }
    if (!projectAddress) {
        throw new Error("PROJECT environment variable is required");
    }

    const networkConfig = NETWORKS[networkName];
    if (!networkConfig) {
        throw new Error(`Unknown network: ${networkName}`);
    }

    // Initialize TronWeb
    const tronWeb = new TronWeb({
        fullHost: networkConfig.fullHost,
        privateKey: privateKey
    });

    const userAddress = tronWeb.address.fromPrivateKey(privateKey);
    const balance = await tronWeb.trx.getBalance(userAddress);

    console.log("========================================");
    console.log("TRON Contract Test");
    console.log("========================================");
    console.log("Network:", networkConfig.name);
    console.log("User:", userAddress);
    console.log("Balance:", tronWeb.fromSun(balance), "TRX");
    console.log("Project:", projectAddress);
    console.log("========================================\n");

    // Load project ABI
    const baseDir = path.join(__dirname, "../../..");
    let artifactsPath = path.join(baseDir, "artifacts-tron/contracts");
    if (!fs.existsSync(artifactsPath)) {
        artifactsPath = path.join(baseDir, "artifacts/contracts");
    }

    const projectArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyPro.sol/PayTheFlyPro.json"))
    );

    // Get project contract
    const project = await tronWeb.contract(projectArtifact.abi, projectAddress);

    let passed = 0;
    let failed = 0;

    // Test 1: Get project info
    console.log("Test 1: getProjectInfo()");
    try {
        const info = await project.getProjectInfo().call();
        console.log("  ✅ Project ID:", info.projectId);
        console.log("     Name:", info.name);
        console.log("     Creator:", tronWeb.address.fromHex(info.creator));
        console.log("     Signer:", tronWeb.address.fromHex(info.signer));
        console.log("     Paused:", info.paused);
        console.log("     Threshold:", info.threshold.toString());
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Test 2: Get admins
    console.log("\nTest 2: getAdmins()");
    try {
        const admins = await project.getAdmins().call();
        console.log("  ✅ Admins:", admins.map(a => tronWeb.address.fromHex(a)));
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Test 3: Get threshold
    console.log("\nTest 3: getThreshold()");
    try {
        const threshold = await project.getThreshold().call();
        console.log("  ✅ Threshold:", threshold.toString());
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Test 4: Check if admin
    console.log("\nTest 4: isAdmin()");
    try {
        const isAdmin = await project.isAdmin(tronWeb.address.toHex(userAddress)).call();
        console.log("  ✅ Is admin:", isAdmin);
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Test 5: Get balance (TRX)
    console.log("\nTest 5: getBalance(TRX)");
    try {
        const trxBalance = await project.getBalance("0x0000000000000000000000000000000000000000").call();
        console.log("  ✅ TRX Balance:", tronWeb.fromSun(trxBalance.toString()), "TRX");
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Test 6: Get EIP712 domain
    console.log("\nTest 6: eip712Domain()");
    try {
        const domain = await project.eip712Domain().call();
        console.log("  ✅ Domain Name:", domain.name);
        console.log("     Version:", domain.version);
        console.log("     Chain ID:", domain.chainId.toString());
        console.log("     Contract:", tronWeb.address.fromHex(domain.verifyingContract));
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Test 7: Deposit to withdrawal pool (send TRX to project)
    console.log("\nTest 7: depositToWithdrawalPool() - sending 5 TRX");
    try {
        const depositAmount = tronWeb.toSun(5); // 5 TRX
        const tx = await project.depositToWithdrawalPool(
            "0x0000000000000000000000000000000000000000",
            depositAmount
        ).send({
            feeLimit: 100000000,
            callValue: depositAmount
        });
        console.log("  ✅ TX:", tx);

        // Wait for confirmation
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check updated balance
        const newBalance = await project.getBalance("0x0000000000000000000000000000000000000000").call();
        console.log("     New TRX Balance:", tronWeb.fromSun(newBalance.toString()), "TRX");
        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        failed++;
    }

    // Test 8: Get proposal count
    console.log("\nTest 8: getProposalCount()");
    try {
        const count = await project.getProposalCount().call();
        console.log("  ✅ Proposal count:", count.toString());
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

    if (failed > 0) {
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Test failed:", error);
        process.exit(1);
    });

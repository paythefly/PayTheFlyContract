/**
 * Test EIP-712 (TIP-712) signed payment and withdrawal on TRON
 *
 * Usage:
 *   npx hardhat run scripts/deploy/tron/testSignedPayment.js --network tronLocal
 *
 * Environment Variables:
 *   TOKEN - Token address (optional, reads from mock-token-local.json)
 *   PROJECT - Project address (required)
 */

const { TronWeb } = require("tronweb");
const fs = require("fs");
const path = require("path");

// Try to load hardhat vars
let hardhatVars;
try {
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

// EIP-712 Types matching the contract
const EIP712_TYPES = {
    PaymentRequest: [
        { name: "projectId", type: "string" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "serialNo", type: "string" },
        { name: "deadline", type: "uint256" }
    ],
    WithdrawalRequest: [
        { name: "user", type: "address" },
        { name: "projectId", type: "string" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "serialNo", type: "string" },
        { name: "deadline", type: "uint256" }
    ]
};

async function main() {
    // Determine network from env
    const networkName = process.env.TRON_NETWORK || "local";

    const networkConfig = NETWORKS[networkName];
    if (!networkConfig) throw new Error(`Unknown network: ${networkName}`);

    const privateKey = getPrivateKey(networkConfig);

    // Load addresses
    const baseDir = path.join(__dirname, "../../..");
    let tokenAddress = process.env.TOKEN;
    const projectAddress = process.env.PROJECT;

    // Load token from file if not provided
    if (!tokenAddress) {
        const tokenFile = path.join(__dirname, "mock-token-local.json");
        if (fs.existsSync(tokenFile)) {
            const data = JSON.parse(fs.readFileSync(tokenFile));
            tokenAddress = data.token.address;
        }
    }

    if (!projectAddress) throw new Error("PROJECT address required (set PROJECT env)");

    // Initialize TronWeb
    const tronWeb = new TronWeb({
        fullHost: networkConfig.fullHost,
        privateKey: privateKey
    });

    // Patch for TRE compatibility
    if (networkName === "local" || networkName === "tronLocal") {
        tronWeb.trx.getCurrentRefBlockParams = async function() {
            const block = await tronWeb.fullNode.request('wallet/getnowblock', {}, 'post');
            const { number, timestamp } = block.block_header.raw_data;
            return {
                ref_block_bytes: number.toString(16).slice(-4).padStart(4, '0'),
                ref_block_hash: block.blockID.slice(16, 32),
                expiration: timestamp + 60 * 1000,
                timestamp,
            };
        };
        console.log("Applied TRE compatibility patch\n");
    }

    const userAddress = tronWeb.address.fromPrivateKey(privateKey);
    const userAddressHex = tronWeb.address.toHex(userAddress).replace(/^41/, "0x");
    const balance = await tronWeb.trx.getBalance(userAddress);

    console.log("========================================");
    console.log("EIP-712 Signed Payment Test (TRON)");
    console.log("========================================");
    console.log("Network:", networkConfig.name);
    console.log("User:", userAddress);
    console.log("User (Hex):", userAddressHex);
    console.log("Balance:", tronWeb.fromSun(balance), "TRX");
    console.log("Project:", projectAddress);
    if (tokenAddress) console.log("Token:", tokenAddress);
    console.log("========================================\n");

    // Load artifacts
    let artifactsPath = path.join(baseDir, "artifacts-tron/contracts");
    if (!fs.existsSync(artifactsPath)) {
        artifactsPath = path.join(baseDir, "artifacts/contracts");
    }

    const projectArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, "PayTheFlyPro.sol/PayTheFlyPro.json"))
    );

    // Get project contract with retry (TRE has delays)
    let project, info, domainInfo;
    for (let i = 0; i < 10; i++) {
        try {
            project = await tronWeb.contract(projectArtifact.abi, projectAddress);
            info = await project.getProjectInfo().call();
            domainInfo = await project.eip712Domain().call();
            break;
        } catch (e) {
            if (i < 9) {
                console.log(`Waiting for contract confirmation (attempt ${i + 1}/10)...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                throw new Error(`Project contract not available after retries: ${e.message}`);
            }
        }
    }

    console.log("Project Info:");
    console.log("  Project ID:", info.projectId);
    console.log("  Name:", info.name);
    console.log("  Signer:", tronWeb.address.fromHex(info.signer));
    console.log("");

    console.log("EIP-712 Domain:");
    console.log("  Name:", domainInfo.name);
    console.log("  Version:", domainInfo.version);
    console.log("  Chain ID:", domainInfo.chainId.toString());
    console.log("  Verifying Contract:", tronWeb.address.fromHex(domainInfo.verifyingContract));
    console.log("");

    // Build domain for signing
    const domain = {
        name: domainInfo.name,
        version: domainInfo.version,
        chainId: domainInfo.chainId.toString(),
        verifyingContract: tronWeb.address.fromHex(domainInfo.verifyingContract)
    };

    let passed = 0;
    let failed = 0;

    // ============ Test 1: TRX Payment with Signature ============
    console.log("Test 1: TRX Payment with EIP-712 Signature");
    try {
        const serialNo = "PAY-TRX-" + Date.now();
        const amount = tronWeb.toSun(1); // 1 TRX
        const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        const tokenAddr = "0x0000000000000000000000000000000000000000"; // ETH/TRX

        const paymentValue = {
            projectId: info.projectId,
            token: tokenAddr,
            amount: amount.toString(),
            serialNo: serialNo,
            deadline: deadline.toString()
        };

        console.log("  Payment Data:");
        console.log("    Serial No:", serialNo);
        console.log("    Amount:", tronWeb.fromSun(amount), "TRX");
        console.log("    Deadline:", new Date(deadline * 1000).toISOString());

        // Sign using TIP-712
        console.log("  Signing with TIP-712...");
        const signature = await tronWeb.trx.signTypedData(
            domain,
            { PaymentRequest: EIP712_TYPES.PaymentRequest },
            paymentValue,
            privateKey
        );
        console.log("  Signature:", signature);

        // Execute payment - pass as array tuple [token, amount, serialNo, deadline]
        console.log("  Executing payment...");
        const paymentTuple = [tokenAddr, amount.toString(), serialNo, deadline];
        const tx = await project.pay(paymentTuple, signature).send({
            feeLimit: 100000000,
            callValue: amount
        });
        console.log("  ✅ Payment TX:", tx);

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check balance
        const projectBalanceResult = await project.getBalance(tokenAddr).call();
        const projectBalance = Array.isArray(projectBalanceResult) ? projectBalanceResult[0] : projectBalanceResult;
        console.log("  Project TRX Balance:", tronWeb.fromSun(projectBalance.toString()), "TRX");

        // Check serial number is used
        const isUsed = await project.isPaymentSerialNoUsed(serialNo).call();
        console.log("  Serial No Used:", isUsed);

        passed++;
    } catch (e) {
        console.log("  ❌ Failed:", e.message);
        if (e.output) console.log("  Output:", JSON.stringify(e.output));
        failed++;
    }

    // ============ Test 2: ERC20 Payment with Signature ============
    if (tokenAddress) {
        console.log("\nTest 2: ERC20 Payment with EIP-712 Signature");
        try {
            const tokenArtifact = JSON.parse(
                fs.readFileSync(path.join(artifactsPath, "mock/MockERC20.sol/MockERC20.json"))
            );
            const token = await tronWeb.contract(tokenArtifact.abi, tokenAddress);

            const decimals = parseInt((await token.decimals().call()).toString());
            const tokenAddrHex = tronWeb.address.toHex(tokenAddress).replace(/^41/, "0x");

            const serialNo = "PAY-ERC20-" + Date.now();
            const amount = BigInt(10) * BigInt(10 ** decimals); // 10 tokens
            const deadline = Math.floor(Date.now() / 1000) + 3600;

            const paymentValue = {
                projectId: info.projectId,
                token: tokenAddrHex,
                amount: amount.toString(),
                serialNo: serialNo,
                deadline: deadline.toString()
            };

            console.log("  Payment Data:");
            console.log("    Token:", tokenAddress);
            console.log("    Serial No:", serialNo);
            console.log("    Amount:", (amount / BigInt(10 ** decimals)).toString(), "tokens");

            // First approve
            console.log("  Approving tokens...");
            await token.approve(
                tronWeb.address.toHex(projectAddress),
                amount.toString()
            ).send({ feeLimit: 100000000 });
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Sign
            console.log("  Signing with TIP-712...");
            const signature = await tronWeb.trx.signTypedData(
                domain,
                { PaymentRequest: EIP712_TYPES.PaymentRequest },
                paymentValue,
                privateKey
            );
            console.log("  Signature:", signature);

            // Execute payment - pass as array tuple [token, amount, serialNo, deadline]
            console.log("  Executing payment...");
            const paymentTuple = [tokenAddrHex, amount.toString(), serialNo, deadline];
            const tx = await project.pay(paymentTuple, signature).send({ feeLimit: 200000000 });
            console.log("  ✅ Payment TX:", tx);

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Check balance
            const projectBalanceResult = await project.getBalance(tokenAddrHex).call();
            const projectBalance = Array.isArray(projectBalanceResult) ? projectBalanceResult[0] : projectBalanceResult;
            console.log("  Project Token Balance:", (BigInt(projectBalance) / BigInt(10 ** decimals)).toString(), "tokens");

            passed++;
        } catch (e) {
            console.log("  ❌ Failed:", e.message);
            if (e.output) console.log("  Output:", JSON.stringify(e.output));
            failed++;
        }

        // ============ Test 3: Withdrawal with Signature ============
        console.log("\nTest 3: TRX Withdrawal with EIP-712 Signature");
        try {
            // First deposit some TRX to withdrawal pool
            console.log("  Depositing 2 TRX to withdrawal pool...");
            await project.depositToWithdrawalPool(
                "0x0000000000000000000000000000000000000000",
                tronWeb.toSun(2)
            ).send({
                feeLimit: 100000000,
                callValue: tronWeb.toSun(2)
            });
            await new Promise(resolve => setTimeout(resolve, 2000));

            const serialNo = "WD-TRX-" + Date.now();
            const amount = tronWeb.toSun(0.5); // 0.5 TRX
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const tokenAddr = "0x0000000000000000000000000000000000000000";

            const withdrawalValue = {
                user: userAddressHex,
                projectId: info.projectId,
                token: tokenAddr,
                amount: amount.toString(),
                serialNo: serialNo,
                deadline: deadline.toString()
            };

            console.log("  Withdrawal Data:");
            console.log("    User:", userAddress);
            console.log("    Serial No:", serialNo);
            console.log("    Amount:", tronWeb.fromSun(amount), "TRX");

            // Sign
            console.log("  Signing with TIP-712...");
            const signature = await tronWeb.trx.signTypedData(
                domain,
                { WithdrawalRequest: EIP712_TYPES.WithdrawalRequest },
                withdrawalValue,
                privateKey
            );
            console.log("  Signature:", signature);

            // Execute withdrawal - pass as array tuple [user, token, amount, serialNo, deadline]
            console.log("  Executing withdrawal...");
            const withdrawalTuple = [userAddressHex, tokenAddr, amount.toString(), serialNo, deadline];
            const tx = await project.withdraw(withdrawalTuple, signature).send({ feeLimit: 100000000 });
            console.log("  ✅ Withdrawal TX:", tx);

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Check serial number is used
            const isUsed = await project.isWithdrawalSerialNoUsed(serialNo).call();
            console.log("  Serial No Used:", isUsed);

            passed++;
        } catch (e) {
            console.log("  ❌ Failed:", e.message);
            if (e.output) console.log("  Output:", JSON.stringify(e.output));
            failed++;
        }
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

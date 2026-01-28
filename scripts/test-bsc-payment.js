/**
 * Test payment on BSC Testnet
 * Usage: npx hardhat run scripts/test-bsc-payment.js --network bscTestnet
 */

const { ethers } = require("hardhat");

const PROJECT_ADDRESS = "0x0c2068fDD15CDb84c4007A1dc0aeB1f80dd04941";
const PROJECT_ID = "test-project-1";
const MOCK_USDT = "0x736F39089ccb949D9944643D8aB9bE8227FC9B58";

const PAYMENT_TYPES = {
    PaymentRequest: [
        { name: "projectId", type: "string" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "serialNo", type: "string" },
        { name: "deadline", type: "uint256" }
    ]
};

async function main() {
    const [signer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("========================================");
    console.log("Test Payment on BSC Testnet");
    console.log("========================================");
    console.log("Network:", network.name, `(chainId: ${network.chainId})`);
    console.log("Signer:", signer.address);
    console.log("Project:", PROJECT_ADDRESS);
    console.log("Token:", MOCK_USDT);
    console.log("========================================\n");

    // Get contracts
    const project = await ethers.getContractAt("PayTheFlyPro", PROJECT_ADDRESS);
    const token = await ethers.getContractAt("MockUSDT", MOCK_USDT);

    // Check token balance
    const balance = await token.balanceOf(signer.address);
    console.log("Token Balance:", ethers.formatUnits(balance, 6), "MUSDT");

    // Approve token
    const amount = ethers.parseUnits("10", 6); // 10 MUSDT
    console.log("\nApproving tokens...");
    const approveTx = await token.approve(PROJECT_ADDRESS, amount);
    await approveTx.wait();
    console.log("Approved:", ethers.formatUnits(amount, 6), "MUSDT");

    // Create payment request
    const serialNo = `PAY_BSC_${Date.now()}`;
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    const payment = {
        projectId: PROJECT_ID,
        token: MOCK_USDT,
        amount: amount,
        serialNo: serialNo,
        deadline: deadline
    };

    // Sign payment
    const domain = {
        name: "PayTheFlyPro",
        version: "1",
        chainId: network.chainId,
        verifyingContract: PROJECT_ADDRESS
    };

    console.log("\nSigning payment...");
    const signature = await signer.signTypedData(domain, PAYMENT_TYPES, payment);
    console.log("Signature:", signature.substring(0, 42) + "...");

    // Execute payment with signature
    console.log("\nExecuting pay...");
    const paymentRequest = {
        token: MOCK_USDT,
        amount: amount,
        serialNo: serialNo,
        deadline: deadline
    };
    const tx = await project.pay(paymentRequest, signature);
    console.log("Transaction hash:", tx.hash);

    const receipt = await tx.wait();
    console.log("Block number:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    // Check for PayTheFlyTransaction event
    const events = receipt.logs.filter(log => {
        try {
            return project.interface.parseLog(log)?.name === "PayTheFlyTransaction";
        } catch {
            return false;
        }
    });

    if (events.length > 0) {
        const event = project.interface.parseLog(events[0]);
        console.log("\n✅ PayTheFlyTransaction Event:");
        console.log("  txType:", event.args.txType.toString());
        console.log("  serialNo:", event.args.serialNo);
        console.log("  wallet:", event.args.wallet);
        console.log("  token:", event.args.token);
        console.log("  amount:", ethers.formatUnits(event.args.amount, 6));
        console.log("  fee:", ethers.formatUnits(event.args.fee, 6));
    }

    console.log("\n========================================");
    console.log("Payment completed!");
    console.log("SerialNo:", serialNo);
    console.log("TxHash:", tx.hash);
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

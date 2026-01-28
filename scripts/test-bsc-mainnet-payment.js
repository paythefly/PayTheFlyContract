/**
 * Test BNB payment on BSC Mainnet
 * Usage: npx hardhat run scripts/test-bsc-mainnet-payment.js --network bsc
 */

const { ethers } = require("hardhat");

const PROJECT_ADDRESS = "0x07Ee2f216B655dE41f22F6E1e76A095E5D3E857c";
const PROJECT_ID = "bsc-mainnet-test-1";

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
    console.log("Test BNB Payment on BSC Mainnet");
    console.log("========================================");
    console.log("Network:", network.name, `(chainId: ${network.chainId})`);
    console.log("Signer:", signer.address);
    console.log("Project:", PROJECT_ADDRESS);
    console.log("========================================\n");

    // Get project contract
    const project = await ethers.getContractAt("PayTheFlyPro", PROJECT_ADDRESS);

    // Check BNB balance
    const balance = await ethers.provider.getBalance(signer.address);
    console.log("BNB Balance:", ethers.formatEther(balance), "BNB");

    // Create payment request with native BNB (0.001 BNB = ~$0.60)
    const amount = ethers.parseEther("0.001"); // 0.001 BNB
    const serialNo = `PAY_BNB_${Date.now()}`;
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    console.log("\nPayment details:");
    console.log("  Amount:", ethers.formatEther(amount), "BNB");
    console.log("  SerialNo:", serialNo);
    console.log("  Deadline:", new Date(deadline * 1000).toISOString());

    // Sign payment using EIP-712
    const domain = {
        name: "PayTheFlyPro",
        version: "1",
        chainId: network.chainId,
        verifyingContract: PROJECT_ADDRESS
    };

    const paymentData = {
        projectId: PROJECT_ID,
        token: ethers.ZeroAddress, // Native BNB
        amount: amount,
        serialNo: serialNo,
        deadline: deadline
    };

    console.log("\nSigning payment...");
    const signature = await signer.signTypedData(domain, PAYMENT_TYPES, paymentData);
    console.log("Signature:", signature.substring(0, 42) + "...");

    // Execute payment with signature
    console.log("\nExecuting pay (sending BNB)...");
    const paymentRequest = {
        token: ethers.ZeroAddress,
        amount: amount,
        serialNo: serialNo,
        deadline: deadline
    };

    const tx = await project.pay(paymentRequest, signature, { value: amount });
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
        console.log("  account:", event.args.account);
        console.log("  token:", event.args.token);
        console.log("  amount:", ethers.formatEther(event.args.amount), "BNB");
        console.log("  fee:", ethers.formatEther(event.args.fee), "BNB");
    }

    console.log("\n========================================");
    console.log("Payment completed!");
    console.log("SerialNo:", serialNo);
    console.log("TxHash:", tx.hash);
    console.log("Block:", receipt.blockNumber);
    console.log("========================================");

    return {
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        serialNo: serialNo
    };
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

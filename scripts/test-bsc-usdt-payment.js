/**
 * Test USDT payment on BSC Mainnet
 * Usage: npx hardhat run scripts/test-bsc-usdt-payment.js --network bsc
 */

const { ethers } = require("hardhat");

const PROJECT_ADDRESS = "0x07Ee2f216B655dE41f22F6E1e76A095E5D3E857c";
const PROJECT_ID = "bsc-mainnet-test-1";
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";

const PAYMENT_TYPES = {
    PaymentRequest: [
        { name: "projectId", type: "string" },
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "serialNo", type: "string" },
        { name: "deadline", type: "uint256" }
    ]
};

// ERC20 ABI for approve and balanceOf
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)"
];

async function main() {
    const [signer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("========================================");
    console.log("Test USDT Payment on BSC Mainnet");
    console.log("========================================");
    console.log("Network:", network.name, `(chainId: ${network.chainId})`);
    console.log("Signer:", signer.address);
    console.log("Project:", PROJECT_ADDRESS);
    console.log("USDT:", USDT_ADDRESS);
    console.log("========================================\n");

    // Get USDT contract
    const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, signer);
    const project = await ethers.getContractAt("PayTheFlyPro", PROJECT_ADDRESS);

    // Check USDT balance
    const balance = await usdt.balanceOf(signer.address);
    const decimals = await usdt.decimals();
    const symbol = await usdt.symbol();
    console.log(`${symbol} Balance:`, ethers.formatUnits(balance, decimals), symbol);

    // Payment amount: 0.1 USDT
    const amount = ethers.parseUnits("0.1", decimals);

    if (balance < amount) {
        console.error(`Insufficient ${symbol} balance. Need at least 0.1 ${symbol}`);
        process.exit(1);
    }

    // Check and set allowance
    const currentAllowance = await usdt.allowance(signer.address, PROJECT_ADDRESS);
    console.log("Current allowance:", ethers.formatUnits(currentAllowance, decimals), symbol);

    if (currentAllowance < amount) {
        console.log("\nApproving USDT...");
        const approveTx = await usdt.approve(PROJECT_ADDRESS, ethers.MaxUint256);
        await approveTx.wait();
        console.log("Approval confirmed:", approveTx.hash);
    }

    // Create payment request
    const serialNo = `PAY_USDT_${Date.now()}`;
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    console.log("\nPayment details:");
    console.log("  Amount:", ethers.formatUnits(amount, decimals), symbol);
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
        token: USDT_ADDRESS,
        amount: amount,
        serialNo: serialNo,
        deadline: deadline
    };

    console.log("\nSigning payment...");
    const signature = await signer.signTypedData(domain, PAYMENT_TYPES, paymentData);
    console.log("Signature:", signature.substring(0, 42) + "...");

    // Execute payment with signature
    console.log("\nExecuting pay (sending USDT)...");
    const paymentRequest = {
        token: USDT_ADDRESS,
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
        console.log("  account:", event.args.account);
        console.log("  token:", event.args.token);
        console.log("  amount:", ethers.formatUnits(event.args.amount, decimals), symbol);
        console.log("  fee:", ethers.formatUnits(event.args.fee, decimals), symbol);
    }

    console.log("\n========================================");
    console.log("USDT Payment completed!");
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

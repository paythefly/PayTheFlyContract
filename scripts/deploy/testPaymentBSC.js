/**
 * Test Payment on BSC Project
 *
 * Usage:
 *   PROJECT=0x... npx hardhat run scripts/deploy/testPaymentBSC.js
 */

const { ethers } = require("ethers");
const { vars } = require("hardhat/config");

const BSC_RPC = "https://bsc-dataseed1.binance.org";
const projectAddress = process.env.PROJECT || "0x5f7f80a061737f50f29d3f3258401595acb85c3c";

const projectAbi = [
    "function getProjectInfo() view returns (tuple(string projectId, string name, address creator, address signer, bool paused, address[] admins, uint256 threshold, uint256 activeProposalCount))",
    "function getBalance(address token) view returns (tuple(uint256 paymentBalance, uint256 withdrawalBalance))",
    "function pay(tuple(address token, uint256 amount, string serialNo, uint256 deadline) request, bytes signature) payable",
    "function isPaymentSerialNoUsed(string serialNo) view returns (bool)"
];

async function main() {
    const privateKey = vars.get("PRODUCT_KEY");
    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log("========================================");
    console.log("BSC Payment Test");
    console.log("========================================");
    console.log("Project:", projectAddress);
    console.log("Payer:", wallet.address);
    console.log("");

    const project = new ethers.Contract(projectAddress, projectAbi, wallet);

    // Get project info
    const info = await project.getProjectInfo();
    console.log("Project ID:", info.projectId);
    console.log("Signer:", info.signer);
    console.log("");

    // Check balances before
    const balanceBefore = await project.getBalance(ethers.ZeroAddress);
    console.log("Payment Pool Before:", ethers.formatEther(balanceBefore.paymentBalance), "BNB");

    // Payment parameters
    const paymentAmount = ethers.parseEther("0.001"); // 0.001 BNB
    const serialNo = `PAY-BSC-${Date.now()}`;
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    console.log("");
    console.log("Payment Details:");
    console.log("  Amount:", ethers.formatEther(paymentAmount), "BNB");
    console.log("  Serial No:", serialNo);
    console.log("  Deadline:", new Date(deadline * 1000).toISOString());

    // EIP-712 Domain
    const domain = {
        name: "PayTheFlyPro",
        version: "1",
        chainId: 56,
        verifyingContract: projectAddress
    };

    // EIP-712 Types
    const types = {
        PaymentRequest: [
            { name: "projectId", type: "string" },
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "serialNo", type: "string" },
            { name: "deadline", type: "uint256" }
        ]
    };

    // EIP-712 Value
    const value = {
        projectId: info.projectId,
        token: ethers.ZeroAddress,
        amount: paymentAmount,
        serialNo: serialNo,
        deadline: deadline
    };

    // Sign with signer (same as payer in this test)
    console.log("");
    console.log("Signing payment request...");
    const signature = await wallet.signTypedData(domain, types, value);
    console.log("Signature:", signature.slice(0, 42) + "...");

    // Execute payment
    console.log("");
    console.log("Sending payment transaction...");

    const gasPrice = (await provider.getFeeData()).gasPrice;
    const tx = await project.pay(
        {
            token: ethers.ZeroAddress,
            amount: paymentAmount,
            serialNo: serialNo,
            deadline: deadline
        },
        signature,
        {
            value: paymentAmount,
            gasPrice: gasPrice,
            gasLimit: 300000
        }
    );

    console.log("TX:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("Confirmed in block:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    // Check balances after
    const balanceAfter = await project.getBalance(ethers.ZeroAddress);
    console.log("");
    console.log("Payment Pool After:", ethers.formatEther(balanceAfter.paymentBalance), "BNB");

    // Calculate fee
    const feeRate = 20; // 0.2%
    const fee = paymentAmount * BigInt(feeRate) / 10000n;
    const netAmount = paymentAmount - fee;

    console.log("");
    console.log("========================================");
    console.log("Payment Success!");
    console.log("========================================");
    console.log("Gross Amount:", ethers.formatEther(paymentAmount), "BNB");
    console.log("Fee (0.2%):", ethers.formatEther(fee), "BNB");
    console.log("Net Amount:", ethers.formatEther(netAmount), "BNB");
    console.log("TX:", "https://bscscan.com/tx/" + tx.hash);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Payment failed:", error);
        process.exit(1);
    });

/**
 * Test depositToWithdrawalPool on BSC Project
 *
 * Usage:
 *   PROJECT=0x... npx hardhat run scripts/deploy/testDepositBSC.js
 */

const { ethers } = require("ethers");
const { vars } = require("hardhat/config");

const BSC_RPC = "https://bsc-dataseed1.binance.org";
const projectAddress = process.env.PROJECT || "0x5f7f80a061737f50f29d3f3258401595acb85c3c";

const projectAbi = [
    "function getProjectInfo() view returns (tuple(string projectId, string name, address creator, address signer, bool paused, address[] admins, uint256 threshold, uint256 activeProposalCount))",
    "function getBalance(address token) view returns (tuple(uint256 paymentBalance, uint256 withdrawalBalance))",
    "function depositToWithdrawalPool(address token, uint256 amount) payable",
    "event AdminPoolOperation(string indexed projectId, address indexed token, address indexed operator, uint256 amount, uint256 fee, uint8 opType)"
];

async function main() {
    const privateKey = vars.get("PRODUCT_KEY");
    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log("========================================");
    console.log("BSC depositToWithdrawalPool Test");
    console.log("========================================");
    console.log("Project:", projectAddress);
    console.log("Operator:", wallet.address);
    console.log("");

    const project = new ethers.Contract(projectAddress, projectAbi, wallet);

    // Get project info
    const info = await project.getProjectInfo();
    console.log("Project ID:", info.projectId);
    console.log("Admins:", info.admins);
    console.log("");

    // Check if wallet is admin
    const isAdmin = info.admins.map(a => a.toLowerCase()).includes(wallet.address.toLowerCase());
    if (!isAdmin) {
        console.error("Error: Wallet is not an admin of this project");
        process.exit(1);
    }
    console.log("Wallet is admin: ✓");
    console.log("");

    // Check balances before
    const balanceBefore = await project.getBalance(ethers.ZeroAddress);
    console.log("Before Deposit:");
    console.log("  Payment Pool:", ethers.formatEther(balanceBefore.paymentBalance), "BNB");
    console.log("  Withdrawal Pool:", ethers.formatEther(balanceBefore.withdrawalBalance), "BNB");

    // Deposit amount
    const depositAmount = ethers.parseEther("0.001"); // 0.001 BNB

    console.log("");
    console.log("Deposit Details:");
    console.log("  Amount:", ethers.formatEther(depositAmount), "BNB");
    console.log("  Token:", "Native BNB (address(0))");

    // Execute deposit
    console.log("");
    console.log("Sending deposit transaction...");

    const gasPrice = (await provider.getFeeData()).gasPrice;
    const tx = await project.depositToWithdrawalPool(
        ethers.ZeroAddress, // Native BNB
        0, // amount param ignored for native token
        {
            value: depositAmount,
            gasPrice: gasPrice,
            gasLimit: 200000
        }
    );

    console.log("TX:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("Confirmed in block:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    // Parse events
    console.log("");
    console.log("Events:");
    for (const log of receipt.logs) {
        try {
            const parsed = project.interface.parseLog(log);
            if (parsed && parsed.name === "AdminPoolOperation") {
                console.log("  AdminPoolOperation:");
                console.log("    projectId:", parsed.args.projectId);
                console.log("    token:", parsed.args.token);
                console.log("    operator:", parsed.args.operator);
                console.log("    amount:", ethers.formatEther(parsed.args.amount), "BNB");
                console.log("    opType:", parsed.args.opType, "(POOL_DEPOSIT)");
            }
        } catch (e) {
            // Ignore unparseable logs
        }
    }

    // Check balances after
    const balanceAfter = await project.getBalance(ethers.ZeroAddress);
    console.log("");
    console.log("After Deposit:");
    console.log("  Payment Pool:", ethers.formatEther(balanceAfter.paymentBalance), "BNB");
    console.log("  Withdrawal Pool:", ethers.formatEther(balanceAfter.withdrawalBalance), "BNB");

    // Verify increase
    const increase = balanceAfter.withdrawalBalance - balanceBefore.withdrawalBalance;
    console.log("");
    console.log("========================================");
    console.log("Deposit Success!");
    console.log("========================================");
    console.log("Deposited:", ethers.formatEther(depositAmount), "BNB");
    console.log("Withdrawal Pool Increase:", ethers.formatEther(increase), "BNB");
    console.log("TX:", "https://bscscan.com/tx/" + tx.hash);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deposit failed:", error);
        process.exit(1);
    });

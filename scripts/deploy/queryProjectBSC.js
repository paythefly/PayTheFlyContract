/**
 * Query BSC Project Contract Status
 *
 * Usage:
 *   PROJECT=0x... npx hardhat run scripts/deploy/queryProjectBSC.js
 */

const { ethers } = require("ethers");

const BSC_RPC = "https://bsc-dataseed1.binance.org";
const projectAddress = process.env.PROJECT || "0x5f7f80a061737f50f29d3f3258401595acb85c3c";

const projectAbi = [
    // View functions
    "function getProjectInfo() view returns (tuple(string projectId, string name, address creator, address signer, bool paused, address[] admins, uint256 threshold, uint256 activeProposalCount))",
    "function getBalance(address token) view returns (tuple(uint256 paymentBalance, uint256 withdrawalBalance))",
    "function isPaymentSerialNoUsed(string serialNo) view returns (bool)",
    "function isWithdrawalSerialNoUsed(string serialNo) view returns (bool)",
    "function getProposal(uint256 proposalId) view returns (tuple(uint256 id, uint8 opType, bytes params, address proposer, uint256 deadline, uint256 confirmCount, bool executed, bool cancelled))",
    "function isConfirmed(uint256 proposalId, address admin) view returns (bool)"
];

// Known BSC Factory address
const FACTORY_ADDRESS = "0xeaADa26c5B9E59ab3BBA1D50fA40813CbB40a65C";

const factoryAbi = [
    "function feeRate() view returns (uint256)",
    "function feeVault() view returns (address)",
    "function beacon() view returns (address)"
];

// Match contract enum IPayTheFlyPro.OperationType
const OperationType = [
    "SetSigner",         // 0: Set new signer address
    "AddAdmin",          // 1: Add new admin
    "RemoveAdmin",       // 2: Remove admin
    "ChangeThreshold",   // 3: Change multi-sig threshold
    "AdminWithdraw",     // 4: Withdraw from payment pool
    "WithdrawFromPool",  // 5: Withdraw from withdrawal pool
    "Pause",             // 6: Pause the project
    "Unpause",           // 7: Unpause the project
    "EmergencyWithdraw"  // 8: Emergency withdraw all funds
];

async function main() {
    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const project = new ethers.Contract(projectAddress, projectAbi, provider);

    console.log("========================================");
    console.log("BSC Project Contract Query");
    console.log("========================================");
    console.log("Project Address:", projectAddress);
    console.log("");

    // 1. Basic Project Info
    console.log("--- Project Info ---");
    const info = await project.getProjectInfo();
    console.log("Project ID:", info.projectId);
    console.log("Name:", info.name);
    console.log("Creator:", info.creator);
    console.log("Signer:", info.signer);
    console.log("Paused:", info.paused);
    console.log("Admins:", info.admins.join(", "));
    console.log("Threshold:", info.threshold.toString());
    console.log("Active Proposals:", info.activeProposalCount.toString());
    console.log("");

    // 2. Factory Info
    console.log("--- Factory Info ---");
    const factoryAddress = FACTORY_ADDRESS;
    console.log("Factory:", factoryAddress);

    const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);
    const feeRate = await factory.feeRate();
    const feeVault = await factory.feeVault();
    const beacon = await factory.beacon();
    console.log("Fee Rate:", feeRate.toString(), `(${Number(feeRate) / 100}%)`);
    console.log("Fee Vault:", feeVault);
    console.log("Beacon:", beacon);
    console.log("");

    // 3. Balances
    console.log("--- Balances ---");
    const bnbBalance = await project.getBalance(ethers.ZeroAddress);
    console.log("Native BNB:");
    console.log("  Payment Pool:", ethers.formatEther(bnbBalance.paymentBalance), "BNB");
    console.log("  Withdrawal Pool:", ethers.formatEther(bnbBalance.withdrawalBalance), "BNB");

    // Common tokens on BSC
    const tokens = [
        { name: "USDT", address: "0x55d398326f99059fF775485246999027B3197955" },
        { name: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
        { name: "BUSD", address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56" }
    ];

    for (const token of tokens) {
        try {
            const balance = await project.getBalance(token.address);
            if (balance.paymentBalance > 0n || balance.withdrawalBalance > 0n) {
                console.log(`${token.name} (${token.address}):`);
                console.log("  Payment Pool:", ethers.formatUnits(balance.paymentBalance, 18));
                console.log("  Withdrawal Pool:", ethers.formatUnits(balance.withdrawalBalance, 18));
            }
        } catch (e) {
            // Token not supported or error
        }
    }
    console.log("");

    // 4. Contract Balance (actual ETH held)
    console.log("--- Contract ETH Balance ---");
    const contractBalance = await provider.getBalance(projectAddress);
    console.log("Total BNB in Contract:", ethers.formatEther(contractBalance), "BNB");
    console.log("");

    // 5. Proposals (if any active)
    if (info.activeProposalCount > 0n) {
        console.log("--- Active Proposals ---");
        // Try to find active proposals (check recent IDs)
        for (let i = 0; i < 10; i++) {
            try {
                const proposal = await project.getProposal(i);
                if (!proposal.executed && !proposal.cancelled && proposal.deadline > Math.floor(Date.now() / 1000)) {
                    console.log(`Proposal #${proposal.id}:`);
                    console.log("  Type:", OperationType[proposal.opType] || `Unknown(${proposal.opType})`);
                    console.log("  Proposer:", proposal.proposer);
                    console.log("  Deadline:", new Date(Number(proposal.deadline) * 1000).toISOString());
                    console.log("  Confirmations:", proposal.confirmCount.toString(), "/", info.threshold.toString());
                    console.log("  Executed:", proposal.executed);
                    console.log("  Cancelled:", proposal.cancelled);

                    // Decode params based on type
                    if (proposal.params && proposal.params !== "0x") {
                        try {
                            if (proposal.opType === 0) {
                                // SetSigner: (address signer)
                                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                                    ["address"],
                                    proposal.params
                                );
                                console.log("  Params:");
                                console.log("    New Signer:", decoded[0]);
                            } else if (proposal.opType === 1 || proposal.opType === 2) {
                                // AddAdmin or RemoveAdmin: (address admin)
                                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                                    ["address"],
                                    proposal.params
                                );
                                console.log("  Params:");
                                console.log("    Admin:", decoded[0]);
                            } else if (proposal.opType === 3) {
                                // ChangeThreshold: (uint256 threshold)
                                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                                    ["uint256"],
                                    proposal.params
                                );
                                console.log("  Params:");
                                console.log("    New Threshold:", decoded[0].toString());
                            } else if (proposal.opType === 4 || proposal.opType === 5) {
                                // AdminWithdraw or WithdrawFromPool: (address token, uint256 amount, address recipient)
                                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                                    ["address", "uint256", "address"],
                                    proposal.params
                                );
                                console.log("  Params:");
                                console.log("    Token:", decoded[0]);
                                console.log("    Amount:", decoded[0] === ethers.ZeroAddress
                                    ? ethers.formatEther(decoded[1]) + " BNB"
                                    : decoded[1].toString());
                                console.log("    Recipient:", decoded[2]);
                            } else if (proposal.opType === 8) {
                                // EmergencyWithdraw: (address token, address recipient)
                                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                                    ["address", "address"],
                                    proposal.params
                                );
                                console.log("  Params:");
                                console.log("    Token:", decoded[0]);
                                console.log("    Recipient:", decoded[1]);
                            }
                            // Pause (6) and Unpause (7) have no params
                        } catch (e) {
                            console.log("  Params (raw):", proposal.params);
                        }
                    }
                    console.log("");
                }
            } catch (e) {
                // Proposal doesn't exist
                break;
            }
        }
    }

    // 6. Summary
    console.log("========================================");
    console.log("Summary");
    console.log("========================================");
    console.log("Project:", info.name, `(${info.projectId})`);
    console.log("Status:", info.paused ? "PAUSED" : "ACTIVE");
    console.log("Multi-sig:", info.admins.length, "admins,", info.threshold.toString(), "required");
    console.log("Total BNB:", ethers.formatEther(contractBalance));
    console.log("  - Payment Pool:", ethers.formatEther(bnbBalance.paymentBalance));
    console.log("  - Withdrawal Pool:", ethers.formatEther(bnbBalance.withdrawalBalance));
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Query failed:", error);
        process.exit(1);
    });

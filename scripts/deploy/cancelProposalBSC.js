/**
 * Cancel Proposal on BSC Project
 *
 * Usage:
 *   PROJECT=0x... PROPOSAL_ID=0 npx hardhat run scripts/deploy/cancelProposalBSC.js
 */

const { ethers } = require("ethers");
const { vars } = require("hardhat/config");

const BSC_RPC = "https://bsc-dataseed1.binance.org";
const projectAddress = process.env.PROJECT || "0x5f7f80a061737f50f29d3f3258401595acb85c3c";
const proposalId = parseInt(process.env.PROPOSAL_ID || "0");

const projectAbi = [
    "function getProposal(uint256 proposalId) view returns (tuple(uint256 id, uint8 opType, bytes params, address proposer, uint256 deadline, uint256 confirmCount, bool executed, bool cancelled))",
    "function cancelProposal(uint256 proposalId)",
    "function getProjectInfo() view returns (tuple(string projectId, string name, address creator, address signer, bool paused, address[] admins, uint256 threshold, uint256 activeProposalCount))",
    "event ProposalCancelled(uint256 indexed proposalId)"
];

const OperationType = [
    "SetSigner", "AddAdmin", "RemoveAdmin", "ChangeThreshold",
    "AdminWithdraw", "WithdrawFromPool", "Pause", "Unpause", "EmergencyWithdraw"
];

async function main() {
    const privateKey = vars.get("PRODUCT_KEY");
    const provider = new ethers.JsonRpcProvider(BSC_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log("========================================");
    console.log("Cancel Proposal on BSC");
    console.log("========================================");
    console.log("Project:", projectAddress);
    console.log("Proposal ID:", proposalId);
    console.log("Wallet:", wallet.address);
    console.log("");

    const project = new ethers.Contract(projectAddress, projectAbi, wallet);

    // Get proposal info
    const proposal = await project.getProposal(proposalId);
    console.log("Proposal Info:");
    console.log("  Type:", OperationType[proposal.opType] || `Unknown(${proposal.opType})`);
    console.log("  Proposer:", proposal.proposer);
    console.log("  Executed:", proposal.executed);
    console.log("  Cancelled:", proposal.cancelled);
    console.log("");

    // Check if can cancel
    if (proposal.executed) {
        console.error("Error: Proposal already executed");
        process.exit(1);
    }
    if (proposal.cancelled) {
        console.error("Error: Proposal already cancelled");
        process.exit(1);
    }
    if (proposal.proposer.toLowerCase() !== wallet.address.toLowerCase()) {
        console.error("Error: Only proposer can cancel. Proposer:", proposal.proposer);
        process.exit(1);
    }

    console.log("Cancelling proposal...");

    const gasPrice = (await provider.getFeeData()).gasPrice;
    const tx = await project.cancelProposal(proposalId, {
        gasPrice: gasPrice,
        gasLimit: 100000
    });

    console.log("TX:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("Confirmed in block:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    // Verify cancellation
    const updatedProposal = await project.getProposal(proposalId);
    const info = await project.getProjectInfo();

    console.log("");
    console.log("========================================");
    console.log("Proposal Cancelled Successfully!");
    console.log("========================================");
    console.log("Proposal #" + proposalId + " cancelled:", updatedProposal.cancelled);
    console.log("Active Proposals:", info.activeProposalCount.toString());
    console.log("TX:", "https://bscscan.com/tx/" + tx.hash);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Cancel failed:", error);
        process.exit(1);
    });

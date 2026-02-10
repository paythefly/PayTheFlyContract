/**
 * Set Withdrawal Fee for ETH Mainnet
 */
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { vars } = require("hardhat/config");

const privateKey = vars.get("PRODUCT_KEY");
const ETH_RPC = "https://ethereum-rpc.publicnode.com";

// Factory Proxy address
const FACTORY_ADDRESS = "0x6e92B74c5951bd38474B44eE59b7885B9e8F61F8";

// Withdrawal fee: 0.00001 ETH (same as BSC)
const WITHDRAWAL_FEE = ethers.parseEther("0.00001");

async function main() {
    const provider = new ethers.JsonRpcProvider(ETH_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log("Setting Withdrawal Fee on ETH Mainnet...");
    console.log("Factory:", FACTORY_ADDRESS);
    console.log("New Fee:", ethers.formatEther(WITHDRAWAL_FEE), "ETH");

    // Load factory ABI
    const factoryArtifact = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../../artifacts/contracts/PayTheFlyProFactory.sol/PayTheFlyProFactory.json"))
    );

    const factory = new ethers.Contract(FACTORY_ADDRESS, factoryArtifact.abi, wallet);

    // Get current fee
    const currentFee = await factory.withdrawalFee();
    console.log("Current Fee:", ethers.formatEther(currentFee), "ETH");

    // Set new fee
    const feeData = await provider.getFeeData();
    const tx = await factory.setWithdrawalFee(WITHDRAWAL_FEE, {
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
    });

    console.log("TX:", tx.hash);
    await tx.wait();
    console.log("Confirmed!");

    // Verify
    const newFee = await factory.withdrawalFee();
    console.log("New Fee:", ethers.formatEther(newFee), "ETH");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error:", error);
        process.exit(1);
    });

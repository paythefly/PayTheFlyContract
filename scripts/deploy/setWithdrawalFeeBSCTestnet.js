/**
 * Set withdrawal fee on BSC Testnet
 * Usage: npx hardhat run scripts/deploy/setWithdrawalFeeBSCTestnet.js --network bscTestnet
 */

const { ethers } = require("hardhat");

const FACTORY = "0x4B48555E9368E9E6e1081f81811dB4d2b269cBc2";

const factoryAbi = [
    "function setWithdrawalFee(uint256 newWithdrawalFee) external",
    "function withdrawalFee() view returns (uint256)",
    "function owner() view returns (address)"
];

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    const factory = new ethers.Contract(FACTORY, factoryAbi, deployer);

    // 0.00001 BNB = 10^13 wei
    const fee = ethers.parseUnits("0.00001", 18);
    console.log("Setting withdrawal fee to:", ethers.formatEther(fee), "BNB");
    console.log("Fee in wei:", fee.toString());

    const tx = await factory.setWithdrawalFee(fee);
    console.log("TX:", tx.hash);
    const receipt = await tx.wait();
    console.log("Confirmed in block:", receipt.blockNumber);

    const newFee = await factory.withdrawalFee();
    console.log("Current withdrawal fee:", ethers.formatEther(newFee), "BNB");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

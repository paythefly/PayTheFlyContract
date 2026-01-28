/**
 * Deploy MockUSDT token
 * Usage: npx hardhat run scripts/deploy/deployMockToken.js --network bscTestnet
 */

const { ethers } = require('hardhat');

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log('========================================');
    console.log('Deploy MockUSDT');
    console.log('========================================');
    console.log('Network:', network.name, `(chainId: ${network.chainId})`);
    console.log('Deployer:', deployer.address);
    console.log('========================================\n');

    console.log('Deploying MockUSDT...');
    const MockUSDT = await ethers.getContractFactory('MockUSDT');
    const token = await MockUSDT.deploy('Mock USDT', 'MUSDT', 6);
    await token.waitForDeployment();

    const address = await token.getAddress();
    console.log('MockUSDT deployed to:', address);

    // Mint some tokens to deployer
    const mintAmount = ethers.parseUnits('1000000', 6);
    console.log('\nMinting 1,000,000 MUSDT to deployer...');
    const tx = await token.mint(deployer.address, mintAmount);
    await tx.wait();

    const balance = await token.balanceOf(deployer.address);
    console.log('Balance:', ethers.formatUnits(balance, 6), 'MUSDT');

    console.log('\n========================================');
    console.log('MockUSDT Deployment Summary');
    console.log('========================================');
    console.log('Address:', address);
    console.log('Name: Mock USDT');
    console.log('Symbol: MUSDT');
    console.log('Decimals: 6');
    console.log('========================================');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

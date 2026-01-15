const hre = require("hardhat");

async function main() {
  // Get the contract factory
  const Lock = await hre.ethers.getContractFactory("Lock");

  // Set unlock time (1 hour from now)
  const unlockTime = Math.floor(Date.now() / 1000) + 3600;

  // Deploy contract
  console.log("Deploying Lock contract to Tron network...");
  const lock = await Lock.deploy(unlockTime, {
    value: hre.ethers.parseEther("0.001")
  });

  await lock.waitForDeployment();

  const address = await lock.getAddress();
  console.log(`Lock deployed to: ${address}`);

  // Tron address format hint
  if (hre.network.config.tron) {
    console.log(`Hex address: ${address}`);
    console.log(`Note: Use tronweb.address.fromHex() to convert to T-address format`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

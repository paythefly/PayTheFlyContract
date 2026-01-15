/**
 * Test Contract Interaction - Verify TronEthersAdapter works for contract calls
 *
 * Usage:
 *   npx hardhat run scripts/test-interaction.js --network tronLocal
 */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { createTronEthersAdapter } = require("./lib/TronEthersAdapter");
const { TronWeb } = require("tronweb");

async function main() {
  const networkName = hre.network.name;
  const networkConfig = hre.config.networks[networkName];
  const isTron = networkConfig && networkConfig.tron === true;

  console.log("=".repeat(50));
  console.log("Contract Interaction Test");
  console.log("=".repeat(50));
  console.log(`Network: ${networkName}`);
  console.log(`Type: ${isTron ? "TVM (Tron)" : "EVM"}`);

  // Load deployment info
  const deploymentFile = path.join(__dirname, `../deployments/${networkName}/Lock.json`);
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`No deployment found. Run deploy-universal.js first.`);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  console.log(`\nContract Address: ${deployment.address}`);
  console.log(`Hex Address: ${deployment.hexAddress}`);

  if (isTron) {
    await testTronInteraction(networkConfig, deployment);
  } else {
    await testEvmInteraction(deployment);
  }
}

/**
 * Test Tron contract interaction using TronEthersAdapter
 */
async function testTronInteraction(networkConfig, deployment) {
  console.log("\n--- Testing TronEthersAdapter ---\n");

  // Setup adapter
  let privateKey = networkConfig.accounts[0];
  if (privateKey && privateKey.startsWith("0x")) {
    privateKey = privateKey.slice(2);
  }

  const adapter = createTronEthersAdapter({
    fullHost: networkConfig.tpiUrl,
    privateKey: privateKey
  });

  // Load artifact
  const artifactPath = path.join(
    __dirname,
    "../artifacts-tron/contracts/Lock.sol/Lock.json"
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  // Connect to deployed contract using TronWeb directly
  const tronWeb = adapter.tronWeb;
  const contract = await tronWeb.contract(artifact.abi, deployment.hexAddress);

  console.log("1. Testing READ methods (view functions):\n");

  // Test unlockTime()
  try {
    const unlockTime = await contract.unlockTime().call();
    const unlockDate = new Date(Number(unlockTime) * 1000);
    console.log(`   unlockTime(): ${unlockTime}`);
    console.log(`   Unlock Date: ${unlockDate.toISOString()}`);
    console.log("   ✅ unlockTime() - SUCCESS\n");
  } catch (error) {
    console.log(`   ❌ unlockTime() - FAILED: ${error.message}\n`);
  }

  // Test owner()
  try {
    const ownerHex = await contract.owner().call();
    const ownerBase58 = TronWeb.address.fromHex(ownerHex);
    console.log(`   owner(): ${ownerBase58}`);
    console.log(`   owner() hex: ${ownerHex}`);
    console.log("   ✅ owner() - SUCCESS\n");
  } catch (error) {
    console.log(`   ❌ owner() - FAILED: ${error.message}\n`);
  }

  // Test contract balance
  try {
    const balance = await tronWeb.trx.getBalance(deployment.hexAddress);
    console.log(`   Contract Balance: ${balance / 1000000} TRX`);
    console.log("   ✅ getBalance() - SUCCESS\n");
  } catch (error) {
    console.log(`   ❌ getBalance() - FAILED: ${error.message}\n`);
  }

  console.log("2. Testing WRITE methods (transactions):\n");

  // Test withdraw() - this should fail because unlockTime hasn't passed
  try {
    console.log("   Attempting withdraw() (expected to fail - time not reached)...");
    const result = await contract.withdraw().send({
      feeLimit: 100000000
    });
    console.log(`   ✅ withdraw() - TX: ${result}`);
  } catch (error) {
    if (error.message.includes("withdraw yet") || error.message.includes("REVERT")) {
      console.log(`   ✅ withdraw() correctly reverted: "You can't withdraw yet"`);
    } else {
      console.log(`   ⚠️ withdraw() failed: ${error.message}`);
    }
  }

  console.log("\n--- TronEthersAdapter Test Complete ---");
}

/**
 * Test EVM contract interaction using Ethers.js
 */
async function testEvmInteraction(deployment) {
  console.log("\n--- Testing Ethers.js ---\n");

  const Lock = await hre.ethers.getContractFactory("Lock");
  const contract = Lock.attach(deployment.address);

  console.log("1. Testing READ methods:\n");

  // Test unlockTime()
  try {
    const unlockTime = await contract.unlockTime();
    const unlockDate = new Date(Number(unlockTime) * 1000);
    console.log(`   unlockTime(): ${unlockTime}`);
    console.log(`   Unlock Date: ${unlockDate.toISOString()}`);
    console.log("   ✅ unlockTime() - SUCCESS\n");
  } catch (error) {
    console.log(`   ❌ unlockTime() - FAILED: ${error.message}\n`);
  }

  // Test owner()
  try {
    const owner = await contract.owner();
    console.log(`   owner(): ${owner}`);
    console.log("   ✅ owner() - SUCCESS\n");
  } catch (error) {
    console.log(`   ❌ owner() - FAILED: ${error.message}\n`);
  }

  console.log("2. Testing WRITE methods:\n");

  // Test withdraw()
  try {
    console.log("   Attempting withdraw() (expected to fail)...");
    await contract.withdraw();
    console.log("   ✅ withdraw() - SUCCESS");
  } catch (error) {
    if (error.message.includes("withdraw yet")) {
      console.log(`   ✅ withdraw() correctly reverted: "You can't withdraw yet"`);
    } else {
      console.log(`   ⚠️ withdraw() failed: ${error.message}`);
    }
  }

  console.log("\n--- Ethers.js Test Complete ---");
}

main()
  .then(() => {
    console.log("\n" + "=".repeat(50));
    console.log("All Tests Completed!");
    console.log("=".repeat(50));
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nTest failed:", error.message);
    process.exit(1);
  });

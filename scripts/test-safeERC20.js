/**
 * Test SafeERC20 with Tron USDT
 *
 * Usage:
 *   npx hardhat run scripts/test-safeERC20.js --network tronMainnet
 *   npx hardhat run scripts/test-safeERC20.js --network tronNile
 */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { TronWeb } = require("tronweb");

// Tron USDT addresses
const USDT_ADDRESSES = {
  tronMainnet: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",  // Mainnet USDT
  tronNile: "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj"     // Nile testnet USDT (may vary)
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const networkName = hre.network.name;
  const networkConfig = hre.config.networks[networkName];

  if (!networkConfig || !networkConfig.tron) {
    throw new Error("This script is for Tron networks only");
  }

  console.log("═".repeat(60));
  console.log("        SafeERC20 Tron USDT Compatibility Test");
  console.log("═".repeat(60));
  console.log(`Network: ${networkName}`);

  // Setup TronWeb
  let privateKey = networkConfig.accounts[0];
  if (privateKey.startsWith("0x")) {
    privateKey = privateKey.slice(2);
  }

  const tronWeb = new TronWeb({
    fullHost: networkConfig.tpiUrl,
    privateKey: privateKey
  });

  const deployer = tronWeb.defaultAddress.base58;
  const deployerHex = tronWeb.defaultAddress.hex;
  console.log(`Deployer: ${deployer}`);

  const balance = await tronWeb.trx.getBalance(deployer);
  console.log(`TRX Balance: ${balance / 1e6} TRX`);

  // Get USDT address for this network
  const usdtBase58 = USDT_ADDRESSES[networkName];
  if (!usdtBase58) {
    console.log("\n⚠️  No USDT address configured for this network");
    console.log("Will deploy test contract and skip USDT tests");
  }

  const usdtHex = usdtBase58 ? TronWeb.address.toHex(usdtBase58) : null;
  console.log(`USDT Address: ${usdtBase58 || "N/A"}`);
  console.log("═".repeat(60));

  // Load and deploy test contract
  const artifactPath = path.join(__dirname, "../artifacts-tron/contracts/test/SafeERC20Test.sol/SafeERC20Test.json");

  if (!fs.existsSync(artifactPath)) {
    console.log("\n❌ Artifact not found. Please compile first:");
    console.log(`   npx hardhat compile --network ${networkName}`);
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath));

  console.log("\n[1] Deploying SafeERC20Test contract...");
  const testContract = await tronWeb.contract().new({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    feeLimit: 1000000000
  });
  const testAddress = TronWeb.address.fromHex(testContract.address);
  console.log(`    Test Contract: ${testAddress}`);
  await sleep(3000);

  const test = await tronWeb.contract(artifact.abi, testContract.address);

  if (!usdtHex) {
    console.log("\n✅ Test contract deployed successfully.");
    console.log("   No USDT address for this network - manual testing required.");
    return;
  }

  // Check USDT balance
  console.log("\n[2] Checking USDT balance...");
  try {
    const usdtBalance = await test.getBalance(usdtHex, deployerHex).call();
    console.log(`    Deployer USDT Balance: ${Number(usdtBalance) / 1e6} USDT`);

    if (Number(usdtBalance) === 0) {
      console.log("\n⚠️  No USDT balance. Cannot run transfer tests.");
      console.log("    Please send some USDT to:", deployer);
      console.log("\n    Test contract deployed at:", testAddress);
      console.log("    You can test manually using TronScan.");
      return;
    }

    // Run tests
    console.log("\n[3] Running transfer analysis tests...");
    console.log("─".repeat(60));

    // Test: Analyze return data
    console.log("\n[3.1] Analyzing transfer return data...");
    console.log("      Sending 0.000001 USDT to analyze return format...");

    // First, send some USDT to test contract
    const usdtContract = await tronWeb.contract().at(usdtBase58);
    console.log("      Transferring 0.01 USDT to test contract...");
    await usdtContract.transfer(testContract.address, 10000).send({ feeLimit: 100000000 }); // 0.01 USDT
    await sleep(5000);

    const testContractBalance = await test.getBalance(usdtHex, testContract.address).call();
    console.log(`      Test contract USDT balance: ${Number(testContractBalance) / 1e6} USDT`);

    if (Number(testContractBalance) > 0) {
      // Now run the analysis
      console.log("\n[3.2] Running analyzeTransferReturn...");
      const receiver = deployerHex; // Send back to deployer
      const amount = 1; // 0.000001 USDT

      try {
        const tx = await test.analyzeTransferReturn(usdtHex, receiver, amount).send({ feeLimit: 100000000 });
        console.log(`      TX: ${tx}`);
        await sleep(5000);

        // Get transaction info to see events
        const txInfo = await tronWeb.trx.getTransactionInfo(tx);
        console.log("\n      Transaction Info:");
        console.log(`      - Result: ${txInfo.result || "SUCCESS"}`);
        console.log(`      - Contract Result: ${txInfo.contractResult ? txInfo.contractResult[0] : "N/A"}`);

        if (txInfo.log && txInfo.log.length > 0) {
          console.log("\n      Events emitted:");
          for (const log of txInfo.log) {
            // Decode the event data
            const data = log.data;
            if (data) {
              console.log(`      - Data: 0x${data}`);
            }
          }
        }

      } catch (e) {
        console.log(`      ❌ analyzeTransferReturn failed: ${e.message}`);
      }

      // Test raw transfer
      console.log("\n[3.3] Testing rawTransfer (low-level call)...");
      try {
        const tx = await test.testRawTransfer(usdtHex, receiver, 1).send({ feeLimit: 100000000 });
        console.log(`      TX: ${tx}`);
        await sleep(5000);

        const txInfo = await tronWeb.trx.getTransactionInfo(tx);
        console.log(`      Result: ${txInfo.result || "SUCCESS"}`);

        // Try to decode contract result
        if (txInfo.contractResult && txInfo.contractResult[0]) {
          const result = txInfo.contractResult[0];
          console.log(`      Contract Result (hex): ${result}`);
          // Parse: first 32 bytes = success (bool), rest = returnData length + data
        }

      } catch (e) {
        console.log(`      ❌ testRawTransfer failed: ${e.message}`);
      }

      // Test SafeERC20 (this should fail with non-standard USDT)
      console.log("\n[3.4] Testing SafeERC20.safeTransfer (OpenZeppelin)...");
      try {
        const tx = await test.testSafeTransfer(usdtHex, receiver, 1).send({ feeLimit: 100000000 });
        console.log(`      TX: ${tx}`);
        await sleep(5000);

        const txInfo = await tronWeb.trx.getTransactionInfo(tx);
        if (txInfo.result === "FAILED" || txInfo.receipt?.result === "REVERT") {
          console.log(`      ❌ FAILED as expected - SafeERC20 incompatible with Tron USDT`);
        } else {
          console.log(`      ✅ SUCCESS - SafeERC20 works (unexpected)`);
        }

      } catch (e) {
        console.log(`      ❌ safeTransfer reverted: ${e.message}`);
        console.log(`      This confirms SafeERC20 is incompatible with Tron USDT`);
      }

      // Test permissive transfer
      console.log("\n[3.5] Testing permissiveTransfer (only checks call success)...");
      try {
        const tx = await test.permissiveTransfer(usdtHex, receiver, 1).send({ feeLimit: 100000000 });
        console.log(`      TX: ${tx}`);
        await sleep(5000);

        const txInfo = await tronWeb.trx.getTransactionInfo(tx);
        if (txInfo.result === "FAILED" || txInfo.receipt?.result === "REVERT") {
          console.log(`      ❌ FAILED`);
        } else {
          console.log(`      ✅ SUCCESS - permissive transfer works`);
        }

      } catch (e) {
        console.log(`      ❌ permissiveTransfer failed: ${e.message}`);
      }
    }

    // Summary
    console.log("\n" + "═".repeat(60));
    console.log("                    SUMMARY");
    console.log("═".repeat(60));
    console.log(`
    Test Contract: ${testAddress}
    USDT Address:  ${usdtBase58}

    The issue with SafeERC20 and Tron USDT:

    1. Tron USDT's transfer() doesn't return a bool value
    2. SafeERC20 checks: returnSize == 0 ? hasCode : returnValue == 1
    3. TVM may return non-zero data even for void functions
    4. When returnSize > 0 but returnValue != 1, it reverts

    Solutions:
    - Use low-level call and only check success (less safe)
    - Create custom SafeERC20 that handles Tron USDT
    - Use TronWeb directly for USDT transfers
    `);

  } catch (error) {
    console.log(`\n❌ Error: ${error.message}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });

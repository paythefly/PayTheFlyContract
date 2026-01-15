/**
 * Detailed SafeERC20 analysis for Tron USDT
 * Specifically tests transfer vs transferFrom return data
 */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { TronWeb } = require("tronweb");

const USDT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const networkName = hre.network.name;
  const networkConfig = hre.config.networks[networkName];

  if (!networkConfig || !networkConfig.tron) {
    throw new Error("This script is for Tron networks only");
  }

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

  console.log("═".repeat(60));
  console.log("   SafeERC20 Detailed Return Data Analysis");
  console.log("═".repeat(60));
  console.log(`Network: ${networkName}`);
  console.log(`Deployer: ${deployer}`);

  // Get USDT contract info
  const usdtHex = TronWeb.address.toHex(USDT_ADDRESS);
  console.log(`USDT: ${USDT_ADDRESS}`);

  // Check USDT contract ABI to see actual function signatures
  console.log("\n[1] Fetching USDT contract info...");
  try {
    const contract = await tronWeb.trx.getContract(USDT_ADDRESS);
    console.log(`    Contract Name: ${contract.name || "Unknown"}`);

    // Look for transfer and transferFrom in ABI
    if (contract.abi && contract.abi.entrys) {
      const entries = contract.abi.entrys;

      console.log("\n    Relevant function signatures:");
      for (const entry of entries) {
        if (entry.name === "transfer" || entry.name === "transferFrom" || entry.name === "approve") {
          const inputs = entry.inputs ? entry.inputs.map(i => `${i.type} ${i.name}`).join(", ") : "";
          const outputs = entry.outputs ? entry.outputs.map(o => o.type).join(", ") : "void";
          console.log(`    - ${entry.name}(${inputs}) returns (${outputs})`);
        }
      }
    }
  } catch (e) {
    console.log(`    Error fetching contract: ${e.message}`);
  }

  // Load test contract
  const artifactPath = path.join(__dirname, "../artifacts-tron/contracts/test/SafeERC20Test.sol/SafeERC20Test.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath));

  // Use existing test contract or deploy new one
  const testAddress = "TFPCMeFCwZswVuaszhs9CTE2wtZuYZhzYQ"; // From previous test
  console.log(`\n[2] Using test contract: ${testAddress}`);

  const test = await tronWeb.contract(artifact.abi, TronWeb.address.toHex(testAddress));

  // Check balances
  const testBalance = await test.getBalance(usdtHex, TronWeb.address.toHex(testAddress)).call();
  console.log(`    Test contract USDT: ${Number(testBalance) / 1e6} USDT`);

  if (Number(testBalance) < 10000) { // Need at least 0.01 USDT
    console.log("\n⚠️  Test contract needs more USDT");
    console.log("    Transferring 0.1 USDT to test contract...");
    const usdt = await tronWeb.contract().at(USDT_ADDRESS);
    await usdt.transfer(TronWeb.address.toHex(testAddress), 100000).send({ feeLimit: 100000000 });
    await sleep(5000);
  }

  // Detailed return data analysis
  console.log("\n[3] Analyzing transfer() return data in detail...");
  console.log("─".repeat(60));

  const receiver = deployerHex;
  const amount = 1; // 0.000001 USDT

  // Use analyzeTransferReturn to get detailed info
  console.log("\n    Calling analyzeTransferReturn...");
  const analyzeTx = await test.analyzeTransferReturn(usdtHex, receiver, amount).send({ feeLimit: 150000000 });
  console.log(`    TX: ${analyzeTx}`);
  await sleep(5000);

  // Get full transaction info
  const txInfo = await tronWeb.trx.getTransactionInfo(analyzeTx);
  console.log(`\n    Transaction Result: ${txInfo.result || "SUCCESS"}`);

  if (txInfo.contractResult && txInfo.contractResult[0]) {
    const resultHex = txInfo.contractResult[0];
    console.log(`    Contract Result (hex): ${resultHex}`);

    // Parse the result - it should be (bool, uint256, uint256, bytes)
    // callSuccess, returnSize, returnValue, fullReturnData
    if (resultHex.length >= 256) {
      const callSuccess = parseInt(resultHex.slice(0, 64), 16);
      const returnSize = parseInt(resultHex.slice(64, 128), 16);
      const returnValue = parseInt(resultHex.slice(128, 192), 16);

      console.log(`\n    Parsed Results:`);
      console.log(`    - callSuccess: ${callSuccess} (${callSuccess === 1 ? "true" : "false"})`);
      console.log(`    - returnSize: ${returnSize}`);
      console.log(`    - returnValue: ${returnValue}`);

      // SafeERC20 logic: returnSize == 0 ? hasCode : returnValue == 1
      if (returnSize === 0) {
        console.log(`    - SafeERC20 check: returnSize == 0, will check hasCode`);
      } else {
        console.log(`    - SafeERC20 check: returnSize > 0, needs returnValue == 1`);
        console.log(`    - Will SafeERC20 pass? ${returnValue === 1 ? "YES ✅" : "NO ❌"}`);
      }
    }
  }

  // Now test transferFrom specifically
  console.log("\n[4] Testing transferFrom scenario...");
  console.log("─".repeat(60));

  // First approve the test contract to spend USDT from deployer
  console.log("\n    Step 1: Approve test contract to spend deployer's USDT...");
  const usdt = await tronWeb.contract().at(USDT_ADDRESS);
  await usdt.approve(TronWeb.address.toHex(testAddress), 1000000).send({ feeLimit: 100000000 }); // 1 USDT
  await sleep(5000);

  const allowance = await test.getAllowance(usdtHex, deployerHex, TronWeb.address.toHex(testAddress)).call();
  console.log(`    Allowance: ${Number(allowance) / 1e6} USDT`);

  // Test SafeERC20.safeTransferFrom
  console.log("\n    Step 2: Testing SafeERC20.safeTransferFrom...");
  try {
    const tx = await test.testSafeTransferFrom(
      usdtHex,
      deployerHex,
      TronWeb.address.toHex(testAddress),
      1
    ).send({ feeLimit: 150000000 });

    console.log(`    TX: ${tx}`);
    await sleep(5000);

    const info = await tronWeb.trx.getTransactionInfo(tx);
    if (info.result === "FAILED" || (info.receipt && info.receipt.result === "REVERT")) {
      console.log(`    ❌ FAILED - SafeERC20.safeTransferFrom does NOT work`);

      // Try to decode the revert reason
      if (info.contractResult && info.contractResult[0]) {
        console.log(`    Revert data: ${info.contractResult[0]}`);
      }
    } else {
      console.log(`    ✅ SUCCESS - SafeERC20.safeTransferFrom works`);
    }
  } catch (e) {
    console.log(`    ❌ Exception: ${e.message}`);
  }

  // Test raw transferFrom to analyze return data
  console.log("\n    Step 3: Analyzing transferFrom return data...");
  try {
    const tx = await test.testRawTransferFrom(
      usdtHex,
      deployerHex,
      TronWeb.address.toHex(testAddress),
      1
    ).send({ feeLimit: 150000000 });

    console.log(`    TX: ${tx}`);
    await sleep(5000);

    const info = await tronWeb.trx.getTransactionInfo(tx);
    console.log(`    Result: ${info.result || "SUCCESS"}`);

    if (info.contractResult && info.contractResult[0]) {
      const resultHex = info.contractResult[0];
      console.log(`    Return (hex): ${resultHex.slice(0, 200)}...`);

      // Parse (bool success, bytes returnData)
      if (resultHex.length >= 128) {
        const success = parseInt(resultHex.slice(0, 64), 16);
        console.log(`    - success: ${success === 1}`);
      }
    }
  } catch (e) {
    console.log(`    Error: ${e.message}`);
  }

  console.log("\n" + "═".repeat(60));
  console.log("                    ANALYSIS COMPLETE");
  console.log("═".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });

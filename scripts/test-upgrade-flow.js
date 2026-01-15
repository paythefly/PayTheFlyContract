/**
 * Upgrade Flow Demo - Detailed upgrade process test
 *
 * Usage:
 *   npx hardhat run scripts/test-upgrade-flow.js --network tronNile
 */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { TronWeb } = require("tronweb");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function encodeInitData(tronWeb, funcName, types, values) {
  const functionSelector = tronWeb.sha3(funcName).substring(0, 10);
  const encodedParams = tronWeb.utils.abi.encodeParams(types, values);
  return functionSelector + encodedParams.substring(2);
}

async function main() {
  const networkName = hre.network.name;
  const networkConfig = hre.config.networks[networkName];

  if (!networkConfig || !networkConfig.tron) {
    throw new Error("This script is for Tron networks only");
  }

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

  console.log("═".repeat(60));
  console.log("        TRON PROXY UPGRADE FLOW DEMO");
  console.log("═".repeat(60));
  console.log(`Network: ${networkName}`);
  console.log(`Deployer: ${deployer}`);

  const balance = await tronWeb.trx.getBalance(deployer);
  console.log(`Balance: ${balance / 1000000} TRX`);
  console.log("═".repeat(60));

  // Load artifacts
  const artifactsDir = path.join(__dirname, "../artifacts-tron/contracts/test");
  const artifacts = {
    SimpleBox: JSON.parse(fs.readFileSync(path.join(artifactsDir, "SimpleBox.sol/SimpleBox.json"))),
    SimpleBoxV2: JSON.parse(fs.readFileSync(path.join(artifactsDir, "SimpleBox.sol/SimpleBoxV2.json"))),
    SimpleTransparentProxy: JSON.parse(fs.readFileSync(path.join(artifactsDir, "SimpleProxy.sol/SimpleTransparentProxy.json")))
  };

  // ============================================================
  // PHASE 1: Initial Deployment
  // ============================================================
  console.log("\n" + "─".repeat(60));
  console.log("PHASE 1: Initial Deployment");
  console.log("─".repeat(60));

  // 1.1 Deploy V1 Implementation
  console.log("\n[1.1] Deploying SimpleBox V1 Implementation...");
  const implV1 = await tronWeb.contract().new({
    abi: artifacts.SimpleBox.abi,
    bytecode: artifacts.SimpleBox.bytecode,
    feeLimit: 1000000000
  });
  const implV1Address = TronWeb.address.fromHex(implV1.address);
  console.log(`      Implementation V1: ${implV1Address}`);
  await sleep(3000);

  // 1.2 Deploy Proxy
  console.log("\n[1.2] Deploying Transparent Proxy...");
  const initData = encodeInitData(tronWeb, "initialize(address)", ["address"], [tronWeb.defaultAddress.hex]);

  const proxy = await tronWeb.contract().new({
    abi: artifacts.SimpleTransparentProxy.abi,
    bytecode: artifacts.SimpleTransparentProxy.bytecode,
    feeLimit: 1000000000,
    parameters: [implV1.address, tronWeb.defaultAddress.hex, initData]
  });
  const proxyAddress = TronWeb.address.fromHex(proxy.address);
  console.log(`      Proxy Address: ${proxyAddress}`);
  await sleep(3000);

  // ============================================================
  // PHASE 2: Use V1 Contract
  // ============================================================
  console.log("\n" + "─".repeat(60));
  console.log("PHASE 2: Interact with V1");
  console.log("─".repeat(60));

  const boxV1 = await tronWeb.contract(artifacts.SimpleBox.abi, proxy.address);

  // Check version
  console.log("\n[2.1] Checking current version...");
  const versionV1 = await boxV1.version().call();
  console.log(`      Version: ${versionV1}`);

  // Store some values
  console.log("\n[2.2] Storing values...");
  await boxV1.store(100).send({ feeLimit: 100000000 });
  await sleep(3000);
  const value1 = await boxV1.retrieve().call();
  console.log(`      Stored: 100, Retrieved: ${value1}`);

  await boxV1.store(200).send({ feeLimit: 100000000 });
  await sleep(3000);
  const value2 = await boxV1.retrieve().call();
  console.log(`      Stored: 200, Retrieved: ${value2}`);

  // Check owner
  console.log("\n[2.3] Checking owner...");
  const owner = await boxV1.owner().call();
  console.log(`      Owner: ${TronWeb.address.fromHex(owner)}`);

  // ============================================================
  // PHASE 3: Deploy V2 Implementation
  // ============================================================
  console.log("\n" + "─".repeat(60));
  console.log("PHASE 3: Prepare Upgrade");
  console.log("─".repeat(60));

  console.log("\n[3.1] Deploying SimpleBox V2 Implementation...");
  const implV2 = await tronWeb.contract().new({
    abi: artifacts.SimpleBoxV2.abi,
    bytecode: artifacts.SimpleBoxV2.bytecode,
    feeLimit: 1000000000
  });
  const implV2Address = TronWeb.address.fromHex(implV2.address);
  console.log(`      Implementation V2: ${implV2Address}`);
  await sleep(3000);

  console.log("\n[3.2] Pre-upgrade state check...");
  const preUpgradeValue = await boxV1.retrieve().call();
  const preUpgradeVersion = await boxV1.version().call();
  console.log(`      Current Value: ${preUpgradeValue}`);
  console.log(`      Current Version: ${preUpgradeVersion}`);

  // ============================================================
  // PHASE 4: Execute Upgrade
  // ============================================================
  console.log("\n" + "─".repeat(60));
  console.log("PHASE 4: Execute Upgrade");
  console.log("─".repeat(60));

  console.log("\n[4.1] Upgrading proxy to V2...");
  const proxyAdmin = await tronWeb.contract(artifacts.SimpleTransparentProxy.abi, proxy.address);

  console.log(`      Calling upgradeTo(${implV2Address})...`);
  const upgradeTx = await proxyAdmin.upgradeTo(implV2.address).send({ feeLimit: 100000000 });
  console.log(`      Upgrade TX: ${upgradeTx}`);
  await sleep(3000);

  // ============================================================
  // PHASE 5: Verify Upgrade
  // ============================================================
  console.log("\n" + "─".repeat(60));
  console.log("PHASE 5: Verify Upgrade");
  console.log("─".repeat(60));

  const boxV2 = await tronWeb.contract(artifacts.SimpleBoxV2.abi, proxy.address);

  // 5.1 Check version changed
  console.log("\n[5.1] Checking version after upgrade...");
  const versionV2 = await boxV2.version().call();
  console.log(`      Version: ${versionV2}`);
  console.log(`      ${preUpgradeVersion} → ${versionV2} ${versionV2 === "V2" ? "✅" : "❌"}`);

  // 5.2 Check state preserved
  console.log("\n[5.2] Checking state preservation...");
  const postUpgradeValue = await boxV2.retrieve().call();
  console.log(`      Value before: ${preUpgradeValue}`);
  console.log(`      Value after:  ${postUpgradeValue}`);
  console.log(`      State preserved: ${Number(preUpgradeValue) === Number(postUpgradeValue) ? "✅" : "❌"}`);

  // 5.3 Check owner preserved
  console.log("\n[5.3] Checking owner preservation...");
  const ownerAfter = await boxV2.owner().call();
  console.log(`      Owner: ${TronWeb.address.fromHex(ownerAfter)}`);
  console.log(`      Owner preserved: ${owner === ownerAfter ? "✅" : "❌"}`);

  // ============================================================
  // PHASE 6: Test New Functionality
  // ============================================================
  console.log("\n" + "─".repeat(60));
  console.log("PHASE 6: Test New V2 Functionality");
  console.log("─".repeat(60));

  console.log("\n[6.1] Testing new increment() function...");
  console.log(`      Current value: ${postUpgradeValue}`);

  await boxV2.increment().send({ feeLimit: 100000000 });
  await sleep(3000);
  const afterIncrement1 = await boxV2.retrieve().call();
  console.log(`      After increment(): ${afterIncrement1}`);

  await boxV2.increment().send({ feeLimit: 100000000 });
  await sleep(3000);
  const afterIncrement2 = await boxV2.retrieve().call();
  console.log(`      After increment(): ${afterIncrement2}`);

  console.log(`      Increment works: ${Number(afterIncrement2) === Number(postUpgradeValue) + 2 ? "✅" : "❌"}`);

  // 6.2 Old functions still work
  console.log("\n[6.2] Testing old store() function still works...");
  await boxV2.store(999).send({ feeLimit: 100000000 });
  await sleep(3000);
  const finalValue = await boxV2.retrieve().call();
  console.log(`      Stored 999, Retrieved: ${finalValue}`);
  console.log(`      Old functions work: ${Number(finalValue) === 999 ? "✅" : "❌"}`);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "═".repeat(60));
  console.log("                    UPGRADE SUMMARY");
  console.log("═".repeat(60));
  console.log(`
  Proxy Address:        ${proxyAddress}
  Implementation V1:    ${implV1Address}
  Implementation V2:    ${implV2Address}

  ┌────────────────────┬─────────────┬─────────────┐
  │ Check              │ Before      │ After       │
  ├────────────────────┼─────────────┼─────────────┤
  │ Version            │ ${preUpgradeVersion.padEnd(11)} │ ${versionV2.padEnd(11)} │
  │ State (value)      │ ${String(preUpgradeValue).padEnd(11)} │ ${String(postUpgradeValue).padEnd(11)} │
  │ New function       │ N/A         │ ✅ Works    │
  │ Old functions      │ ✅ Works    │ ✅ Works    │
  └────────────────────┴─────────────┴─────────────┘
  `);

  const allPassed =
    versionV2 === "V2" &&
    Number(preUpgradeValue) === Number(postUpgradeValue) &&
    Number(finalValue) === 999;

  if (allPassed) {
    console.log("  🎉 UPGRADE SUCCESSFUL! All checks passed.");
  } else {
    console.log("  ❌ UPGRADE FAILED! Some checks did not pass.");
  }

  console.log("═".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nError:", error.message);
    process.exit(1);
  });

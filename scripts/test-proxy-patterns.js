/**
 * Test Proxy Patterns on Tron - Transparent, UUPS, Beacon
 *
 * Usage:
 *   npx hardhat run scripts/test-proxy-patterns.js --network tronLocal
 */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { TronWeb } = require("tronweb");

// Test results
const results = {
  transparent: { deploy: false, interact: false, upgrade: false },
  uups: { deploy: false, interact: false, upgrade: false },
  beacon: { deploy: false, interact: false, upgrade: false }
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

  console.log("=".repeat(60));
  console.log("Tron Proxy Patterns Test");
  console.log("=".repeat(60));
  console.log(`Network: ${networkName}\n`);

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
  console.log(`Deployer: ${deployer}\n`);

  // Load artifacts
  const artifacts = loadArtifacts();

  // Run tests
  await testTransparentProxy(tronWeb, artifacts);
  await testUUPSProxy(tronWeb, artifacts);
  await testBeaconProxy(tronWeb, artifacts);

  // Print summary
  printSummary();
}

function loadArtifacts() {
  const artifactsDir = path.join(__dirname, "../artifacts-tron/contracts");
  return {
    BoxV1: JSON.parse(fs.readFileSync(path.join(artifactsDir, "test/BoxV1.sol/BoxV1.json"))),
    BoxV2: JSON.parse(fs.readFileSync(path.join(artifactsDir, "test/BoxV2.sol/BoxV2.json"))),
    BoxUUPSV1: JSON.parse(fs.readFileSync(path.join(artifactsDir, "test/BoxUUPSV1.sol/BoxUUPSV1.json"))),
    BoxUUPSV2: JSON.parse(fs.readFileSync(path.join(artifactsDir, "test/BoxUUPSV2.sol/BoxUUPSV2.json"))),
    SimpleBox: JSON.parse(fs.readFileSync(path.join(artifactsDir, "test/SimpleBox.sol/SimpleBox.json"))),
    SimpleBoxV2: JSON.parse(fs.readFileSync(path.join(artifactsDir, "test/SimpleBox.sol/SimpleBoxV2.json"))),
    SimpleTransparentProxy: JSON.parse(fs.readFileSync(path.join(artifactsDir, "test/SimpleProxy.sol/SimpleTransparentProxy.json"))),
    SimpleUUPSProxy: JSON.parse(fs.readFileSync(path.join(artifactsDir, "test/SimpleProxy.sol/SimpleUUPSProxy.json"))),
    SimpleBeacon: JSON.parse(fs.readFileSync(path.join(artifactsDir, "test/SimpleProxy.sol/SimpleBeacon.json"))),
    SimpleBeaconProxy: JSON.parse(fs.readFileSync(path.join(artifactsDir, "test/SimpleProxy.sol/SimpleBeaconProxy.json")))
  };
}

function encodeInitData(tronWeb, funcName, types, values) {
  const functionSelector = tronWeb.sha3(funcName).substring(0, 10);
  const encodedParams = tronWeb.utils.abi.encodeParams(types, values);
  return functionSelector + encodedParams.substring(2);
}

/**
 * Test 1: Transparent Proxy Pattern
 */
async function testTransparentProxy(tronWeb, artifacts) {
  console.log("-".repeat(60));
  console.log("TEST 1: Transparent Proxy");
  console.log("-".repeat(60));

  try {
    // 1. Deploy implementation V1
    console.log("\n1.1 Deploying SimpleBox (V1)...");
    const implV1 = await tronWeb.contract().new({
      abi: artifacts.SimpleBox.abi,
      bytecode: artifacts.SimpleBox.bytecode,
      feeLimit: 1000000000
    });
    console.log(`    V1: ${TronWeb.address.fromHex(implV1.address)}`);
    await sleep(2000);

    // 2. Deploy implementation V2
    console.log("1.2 Deploying SimpleBoxV2 (V2)...");
    const implV2 = await tronWeb.contract().new({
      abi: artifacts.SimpleBoxV2.abi,
      bytecode: artifacts.SimpleBoxV2.bytecode,
      feeLimit: 1000000000
    });
    console.log(`    V2: ${TronWeb.address.fromHex(implV2.address)}`);
    await sleep(2000);

    // 3. Deploy Transparent Proxy
    console.log("1.3 Deploying Transparent Proxy...");
    const initData = encodeInitData(tronWeb, "initialize(address)", ["address"], [tronWeb.defaultAddress.hex]);

    const proxy = await tronWeb.contract().new({
      abi: artifacts.SimpleTransparentProxy.abi,
      bytecode: artifacts.SimpleTransparentProxy.bytecode,
      feeLimit: 1000000000,
      parameters: [implV1.address, tronWeb.defaultAddress.hex, initData]
    });
    console.log(`    Proxy: ${TronWeb.address.fromHex(proxy.address)}`);
    results.transparent.deploy = true;
    console.log("    ✅ Deploy SUCCESS");
    await sleep(2000);

    // 4. Interact through proxy
    console.log("1.4 Testing interaction...");
    const boxProxy = await tronWeb.contract(artifacts.SimpleBox.abi, proxy.address);

    await boxProxy.store(42).send({ feeLimit: 100000000 });
    await sleep(2000);
    const value = await boxProxy.retrieve().call();
    const version = await boxProxy.version().call();
    console.log(`    Value: ${value}, Version: ${version}`);

    if (Number(value) === 42 && version === "V1") {
      results.transparent.interact = true;
      console.log("    ✅ Interaction SUCCESS");
    }

    // 5. Upgrade to V2
    console.log("1.5 Upgrading to V2...");
    const proxyAdmin = await tronWeb.contract(artifacts.SimpleTransparentProxy.abi, proxy.address);
    await proxyAdmin.upgradeTo(implV2.address).send({ feeLimit: 100000000 });
    await sleep(2000);

    const boxProxyV2 = await tronWeb.contract(artifacts.SimpleBoxV2.abi, proxy.address);
    const versionAfter = await boxProxyV2.version().call();
    await boxProxyV2.increment().send({ feeLimit: 100000000 });
    await sleep(2000);
    const valueAfter = await boxProxyV2.retrieve().call();
    console.log(`    Value: ${valueAfter}, Version: ${versionAfter}`);

    if (versionAfter === "V2" && Number(valueAfter) === 43) {
      results.transparent.upgrade = true;
      console.log("    ✅ Upgrade SUCCESS");
    }

  } catch (error) {
    console.log(`    ❌ FAILED: ${error.message}`);
  }
}

/**
 * Test 2: UUPS Proxy Pattern
 */
async function testUUPSProxy(tronWeb, artifacts) {
  console.log("\n" + "-".repeat(60));
  console.log("TEST 2: UUPS Proxy");
  console.log("-".repeat(60));

  try {
    // 1. Deploy implementation V1
    console.log("\n2.1 Deploying BoxUUPSV1...");
    const implV1 = await tronWeb.contract().new({
      abi: artifacts.BoxUUPSV1.abi,
      bytecode: artifacts.BoxUUPSV1.bytecode,
      feeLimit: 1000000000
    });
    console.log(`    V1: ${TronWeb.address.fromHex(implV1.address)}`);
    await sleep(2000);

    // 2. Deploy implementation V2
    console.log("2.2 Deploying BoxUUPSV2...");
    const implV2 = await tronWeb.contract().new({
      abi: artifacts.BoxUUPSV2.abi,
      bytecode: artifacts.BoxUUPSV2.bytecode,
      feeLimit: 1000000000
    });
    console.log(`    V2: ${TronWeb.address.fromHex(implV2.address)}`);
    await sleep(2000);

    // 3. Deploy UUPS Proxy
    console.log("2.3 Deploying UUPS Proxy...");
    const initData = encodeInitData(tronWeb, "initialize(address)", ["address"], [tronWeb.defaultAddress.hex]);

    const proxy = await tronWeb.contract().new({
      abi: artifacts.SimpleUUPSProxy.abi,
      bytecode: artifacts.SimpleUUPSProxy.bytecode,
      feeLimit: 1000000000,
      parameters: [implV1.address, initData]
    });
    console.log(`    Proxy: ${TronWeb.address.fromHex(proxy.address)}`);
    results.uups.deploy = true;
    console.log("    ✅ Deploy SUCCESS");
    await sleep(2000);

    // 4. Interact
    console.log("2.4 Testing interaction...");
    const boxProxy = await tronWeb.contract(artifacts.BoxUUPSV1.abi, proxy.address);

    await boxProxy.store(100).send({ feeLimit: 100000000 });
    await sleep(2000);
    const value = await boxProxy.retrieve().call();
    const version = await boxProxy.version().call();
    console.log(`    Value: ${value}, Version: ${version}`);

    if (Number(value) === 100 && version === "UUPS-V1") {
      results.uups.interact = true;
      console.log("    ✅ Interaction SUCCESS");
    }

    // 5. Upgrade via UUPS
    console.log("2.5 Upgrading via UUPS...");
    await boxProxy.upgradeToAndCall(implV2.address, "0x").send({ feeLimit: 100000000 });
    await sleep(2000);

    const boxProxyV2 = await tronWeb.contract(artifacts.BoxUUPSV2.abi, proxy.address);
    const versionAfter = await boxProxyV2.version().call();
    await boxProxyV2.increment().send({ feeLimit: 100000000 });
    await sleep(2000);
    const valueAfter = await boxProxyV2.retrieve().call();
    console.log(`    Value: ${valueAfter}, Version: ${versionAfter}`);

    if (versionAfter === "UUPS-V2" && Number(valueAfter) === 101) {
      results.uups.upgrade = true;
      console.log("    ✅ Upgrade SUCCESS");
    }

  } catch (error) {
    console.log(`    ❌ FAILED: ${error.message}`);
  }
}

/**
 * Test 3: Beacon Proxy Pattern
 */
async function testBeaconProxy(tronWeb, artifacts) {
  console.log("\n" + "-".repeat(60));
  console.log("TEST 3: Beacon Proxy");
  console.log("-".repeat(60));

  try {
    // 1. Deploy implementation V1
    console.log("\n3.1 Deploying SimpleBox (V1)...");
    const implV1 = await tronWeb.contract().new({
      abi: artifacts.SimpleBox.abi,
      bytecode: artifacts.SimpleBox.bytecode,
      feeLimit: 1000000000
    });
    console.log(`    V1: ${TronWeb.address.fromHex(implV1.address)}`);
    await sleep(2000);

    // 2. Deploy implementation V2
    console.log("3.2 Deploying SimpleBoxV2 (V2)...");
    const implV2 = await tronWeb.contract().new({
      abi: artifacts.SimpleBoxV2.abi,
      bytecode: artifacts.SimpleBoxV2.bytecode,
      feeLimit: 1000000000
    });
    console.log(`    V2: ${TronWeb.address.fromHex(implV2.address)}`);
    await sleep(2000);

    // 3. Deploy Beacon
    console.log("3.3 Deploying Beacon...");
    const beacon = await tronWeb.contract().new({
      abi: artifacts.SimpleBeacon.abi,
      bytecode: artifacts.SimpleBeacon.bytecode,
      feeLimit: 1000000000,
      parameters: [implV1.address, tronWeb.defaultAddress.hex]
    });
    console.log(`    Beacon: ${TronWeb.address.fromHex(beacon.address)}`);
    await sleep(2000);

    // 4. Deploy Beacon Proxy
    console.log("3.4 Deploying Beacon Proxy...");
    const initData = encodeInitData(tronWeb, "initialize(address)", ["address"], [tronWeb.defaultAddress.hex]);

    const proxy = await tronWeb.contract().new({
      abi: artifacts.SimpleBeaconProxy.abi,
      bytecode: artifacts.SimpleBeaconProxy.bytecode,
      feeLimit: 1000000000,
      parameters: [beacon.address, initData]
    });
    console.log(`    Proxy: ${TronWeb.address.fromHex(proxy.address)}`);
    results.beacon.deploy = true;
    console.log("    ✅ Deploy SUCCESS");
    await sleep(2000);

    // 5. Interact
    console.log("3.5 Testing interaction...");
    const boxProxy = await tronWeb.contract(artifacts.SimpleBox.abi, proxy.address);

    await boxProxy.store(200).send({ feeLimit: 100000000 });
    await sleep(2000);
    const value = await boxProxy.retrieve().call();
    const version = await boxProxy.version().call();
    console.log(`    Value: ${value}, Version: ${version}`);

    if (Number(value) === 200 && version === "V1") {
      results.beacon.interact = true;
      console.log("    ✅ Interaction SUCCESS");
    }

    // 6. Upgrade via Beacon
    console.log("3.6 Upgrading via Beacon...");
    const beaconContract = await tronWeb.contract(artifacts.SimpleBeacon.abi, beacon.address);
    await beaconContract.upgradeTo(implV2.address).send({ feeLimit: 100000000 });
    await sleep(2000);

    const boxProxyV2 = await tronWeb.contract(artifacts.SimpleBoxV2.abi, proxy.address);
    const versionAfter = await boxProxyV2.version().call();
    await boxProxyV2.increment().send({ feeLimit: 100000000 });
    await sleep(2000);
    const valueAfter = await boxProxyV2.retrieve().call();
    console.log(`    Value: ${valueAfter}, Version: ${versionAfter}`);

    if (versionAfter === "V2" && Number(valueAfter) === 201) {
      results.beacon.upgrade = true;
      console.log("    ✅ Upgrade SUCCESS");
    }

  } catch (error) {
    console.log(`    ❌ FAILED: ${error.message}`);
  }
}

function printSummary() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));

  console.log("\n┌─────────────────────┬────────┬──────────┬─────────┐");
  console.log("│ Pattern             │ Deploy │ Interact │ Upgrade │");
  console.log("├─────────────────────┼────────┼──────────┼─────────┤");

  const patterns = [
    ["Transparent Proxy", results.transparent],
    ["UUPS Proxy", results.uups],
    ["Beacon Proxy", results.beacon]
  ];

  for (const [name, r] of patterns) {
    const deploy = r.deploy ? "  ✅  " : "  ❌  ";
    const interact = r.interact ? "   ✅   " : "   ❌   ";
    const upgrade = r.upgrade ? "   ✅  " : "   ❌  ";
    console.log(`│ ${name.padEnd(19)} │${deploy}│${interact}│${upgrade}│`);
  }

  console.log("└─────────────────────┴────────┴──────────┴─────────┘");

  const total = Object.values(results).reduce((sum, r) =>
    sum + (r.deploy ? 1 : 0) + (r.interact ? 1 : 0) + (r.upgrade ? 1 : 0), 0);

  console.log(`\nTotal: ${total}/9 tests passed`);

  if (total === 9) {
    console.log("\n🎉 All proxy patterns work on Tron!");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nTest failed:", error.message);
    process.exit(1);
  });

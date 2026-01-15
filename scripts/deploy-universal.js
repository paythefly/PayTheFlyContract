/**
 * Universal Deploy Script - Supports both EVM and TVM networks
 *
 * Usage (unified command for all networks):
 *   npx hardhat run scripts/deploy-universal.js --network <network>
 *
 * Examples:
 *   npx hardhat run scripts/deploy-universal.js --network bsc
 *   npx hardhat run scripts/deploy-universal.js --network tronLocal
 *   npx hardhat run scripts/deploy-universal.js --network tronNile
 *
 * Network type is auto-detected from hardhat.config.js (tron: true)
 */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

// Configuration for contracts to deploy
const DEPLOY_CONFIG = {
  contractName: "Lock",
  constructorArgs: () => [Math.floor(Date.now() / 1000) + 3600], // unlock time
  value: {
    evm: "0.001",  // ETH/BNB/MATIC
    tvm: "1000000" // 1 TRX in sun
  }
};

/**
 * Get Ethers-compatible interface for any network
 */
async function getEthersInterface(networkName) {
  const networkConfig = hre.config.networks[networkName];
  const isTron = networkConfig && networkConfig.tron === true;

  if (isTron) {
    // Use TronEthersAdapter for Tron networks
    const { createTronEthersAdapter } = require("./lib/TronEthersAdapter");

    let privateKey = networkConfig.accounts[0];
    if (privateKey && privateKey.startsWith("0x")) {
      privateKey = privateKey.slice(2);
    }

    const adapter = createTronEthersAdapter({
      fullHost: networkConfig.tpiUrl,
      privateKey: privateKey,
      headers: networkConfig.httpHeaders || {}
    });

    return {
      type: "tvm",
      ethers: adapter,
      getArtifact: (contractName) => {
        const artifactPath = path.join(
          __dirname,
          `../artifacts-tron/contracts/${contractName}.sol/${contractName}.json`
        );
        if (!fs.existsSync(artifactPath)) {
          throw new Error(`Tron artifact not found. Run: npx hardhat compile --network ${networkName}`);
        }
        return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      }
    };
  } else {
    // Use standard Hardhat ethers for EVM networks
    return {
      type: "evm",
      ethers: hre.ethers,
      getArtifact: async (contractName) => {
        return await hre.artifacts.readArtifact(contractName);
      }
    };
  }
}

/**
 * Unified deploy function - works for both EVM and TVM
 */
async function deploy(contractName, constructorArgs, value) {
  const networkName = hre.network.name;
  const { type, ethers, getArtifact } = await getEthersInterface(networkName);

  console.log("=".repeat(50));
  console.log("Universal Deploy Script");
  console.log("=".repeat(50));
  console.log(`Network: ${networkName}`);
  console.log(`Type: ${type === "tvm" ? "TVM (Tron)" : "EVM"}`);
  console.log(`Contract: ${contractName}`);

  // Get deployer info
  let deployer, balance;
  if (type === "tvm") {
    deployer = await ethers.signer.getAddress();
    balance = ethers.formatEther(await ethers.signer.getBalance());
    console.log(`\nDeployer: ${deployer}`);
    console.log(`Balance: ${balance} TRX`);
  } else {
    const [signer] = await ethers.getSigners();
    deployer = signer.address;
    balance = hre.ethers.formatEther(await ethers.provider.getBalance(deployer));
    console.log(`\nDeployer: ${deployer}`);
    console.log(`Balance: ${balance} ETH`);
  }

  // Get artifact and deploy
  console.log(`\nDeploying ${contractName}...`);

  let contract, address, hexAddress;

  if (type === "tvm") {
    const artifact = getArtifact(contractName);
    const factory = ethers.getContractFactory(artifact.abi, artifact.bytecode);
    contract = await factory.deploy(...constructorArgs, { value: BigInt(value.tvm) });
    await contract.waitForDeployment();
    address = await contract.getAddress();
    hexAddress = contract.getHexAddress();
  } else {
    const Contract = await ethers.getContractFactory(contractName);
    contract = await Contract.deploy(...constructorArgs, {
      value: hre.ethers.parseEther(value.evm)
    });
    await contract.waitForDeployment();
    address = await contract.getAddress();
    hexAddress = address;
  }

  console.log(`\nContract deployed!`);
  console.log(`Address: ${address}`);
  if (type === "tvm") {
    console.log(`Hex Address: ${hexAddress}`);
  }

  // Save deployment record
  const deploymentsDir = path.join(__dirname, "../deployments", networkName);
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentsDir, `${contractName}.json`);
  const deploymentData = {
    contractName,
    address,
    hexAddress,
    network: networkName,
    networkType: type,
    deployer,
    deployedAt: new Date().toISOString(),
    constructorArgs
  };

  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));

  console.log("\n" + "=".repeat(50));
  console.log("Deployment Complete!");
  console.log("=".repeat(50));
  console.log(`Saved to: ${deploymentFile}`);

  return { address, hexAddress, type };
}

// Main execution
async function main() {
  const args = DEPLOY_CONFIG.constructorArgs();
  return await deploy(DEPLOY_CONFIG.contractName, args, DEPLOY_CONFIG.value);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDeployment failed:", error.message);
    process.exit(1);
  });

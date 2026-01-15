const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  // Read compiled artifact from tron artifacts
  const artifactPath = path.join(
    __dirname,
    "../artifacts-tron/contracts/Lock.sol/Lock.json"
  );

  if (!fs.existsSync(artifactPath)) {
    console.log("Tron artifact not found. Please compile with: npx hardhat compile --network tronLocal");
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const bytecode = artifact.bytecode;
  const abi = artifact.abi;

  // Use TronWeb to deploy
  const { TronWeb } = require("tronweb");

  const tronWeb = new TronWeb({
    fullHost: "http://127.0.0.1:9090",
    privateKey: "a2d23d568a7d3dd998345b55fff9421783bedb9a730b5cdb42225399082cf605"
  });

  console.log("Deployer:", tronWeb.defaultAddress.base58);

  // Set unlock time (1 hour from now)
  const unlockTime = Math.floor(Date.now() / 1000) + 3600;

  console.log("Deploying Lock contract...");
  console.log("Unlock time:", new Date(unlockTime * 1000).toISOString());

  try {
    // Create contract instance
    const contract = await tronWeb.contract().new({
      abi: abi,
      bytecode: bytecode,
      feeLimit: 1000000000,
      callValue: 1000000, // 1 TRX
      parameters: [unlockTime]
    });

    console.log("Contract deployed successfully!");
    console.log("Contract address:", contract.address);
  } catch (error) {
    console.error("Deployment failed:", error.message);
    if (error.error) {
      console.error("Details:", JSON.stringify(error.error, null, 2));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

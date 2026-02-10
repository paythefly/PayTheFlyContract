/**
 * Verify Factory-created Project Contract (BeaconProxy)
 *
 * Usage:
 *   PROJECT=0x... NETWORK=bsc node scripts/deploy/verifyProject.js
 *   PROJECT=0x... NETWORK=mainnet node scripts/deploy/verifyProject.js
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Network configurations
const NETWORKS = {
    bsc: {
        rpc: "https://bsc-dataseed1.binance.org",
        chainId: 56,
        factory: "0xeaADa26c5B9E59ab3BBA1D50fA40813CbB40a65C",
        beacon: "0x41f8D4AB1f4F9062a531ABB66333E41C0BD2f0cC"
    },
    mainnet: {
        rpc: "https://ethereum-rpc.publicnode.com",
        chainId: 1,
        factory: "0x6e92B74c5951bd38474B44eE59b7885B9e8F61F8",
        beacon: "0xc2fB47b16b9751B621E60AbB3c77a74322AC40C4"
    }
};

async function main() {
    const projectAddress = process.env.PROJECT;
    const networkName = process.env.NETWORK || "bsc";

    if (!projectAddress) {
        console.error("Error: PROJECT environment variable required");
        console.log("Usage: PROJECT=0x... NETWORK=bsc node scripts/deploy/verifyProject.js");
        process.exit(1);
    }

    const network = NETWORKS[networkName];
    if (!network) {
        console.error("Error: Unknown network:", networkName);
        console.log("Available networks:", Object.keys(NETWORKS).join(", "));
        process.exit(1);
    }

    console.log("========================================");
    console.log("Verify Factory-created Project Contract");
    console.log("========================================");
    console.log("Network:", networkName);
    console.log("Project:", projectAddress);
    console.log("Factory:", network.factory);
    console.log("Beacon:", network.beacon);
    console.log("");

    // Connect to network
    const provider = new ethers.JsonRpcProvider(network.rpc);

    // Load PayTheFlyPro ABI
    const projectArtifact = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../../artifacts/contracts/PayTheFlyPro.sol/PayTheFlyPro.json"))
    );

    // Get project info
    const project = new ethers.Contract(projectAddress, projectArtifact.abi, provider);

    let projectId, name, creator, admin, signer;
    try {
        const info = await project.getProjectInfo();

        // ProjectInfo structure:
        // projectId, name, creator, signer, paused, admins, threshold, activeProposalCount
        projectId = info[0];
        name = info[1];
        creator = info[2];
        signer = info[3];
        admin = info[5][0];  // First admin

        console.log("Project Info:");
        console.log("  projectId:", projectId);
        console.log("  name:", name);
        console.log("  creator:", creator);
        console.log("  signer:", signer);
        console.log("  admin:", admin);
        console.log("");
    } catch (e) {
        console.error("Error reading project info:", e.message);
        process.exit(1);
    }

    // Generate initialize calldata
    // initialize(string projectId, string name, address creator, address admin, address signer)
    const iface = new ethers.Interface(projectArtifact.abi);
    const initData = iface.encodeFunctionData("initialize", [
        projectId,
        name,
        creator,
        admin,
        signer
    ]);

    console.log("BeaconProxy Constructor Args:");
    console.log("  beacon:", network.beacon);
    console.log("  data:", initData.slice(0, 66) + "...");
    console.log("");

    // Save constructor args to file
    const argsFile = path.join(__dirname, `project-args-${projectAddress.slice(0, 12)}.js`);
    const argsContent = `// BeaconProxy constructor args for project ${projectAddress}
// constructor(address beacon, bytes memory data)
module.exports = [
  "${network.beacon}",
  "${initData}"
];
`;
    fs.writeFileSync(argsFile, argsContent);
    console.log("Constructor args saved to:", argsFile);
    console.log("");

    // Generate verification command
    console.log("========================================");
    console.log("Verification Command:");
    console.log("========================================");
    console.log(`npx hardhat verify --network ${networkName} \\`);
    console.log(`  --contract "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol:BeaconProxy" \\`);
    console.log(`  --constructor-args ${argsFile} \\`);
    console.log(`  ${projectAddress}`);
    console.log("");

    // Try to verify automatically
    console.log("========================================");
    console.log("Attempting automatic verification...");
    console.log("========================================");

    try {
        const cmd = `npx hardhat verify --network ${networkName} --contract "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol:BeaconProxy" --constructor-args ${argsFile} ${projectAddress}`;
        const result = execSync(cmd, { encoding: "utf-8", stdio: "pipe", cwd: path.join(__dirname, "../..") });
        console.log(result);
    } catch (e) {
        if (e.stdout) console.log(e.stdout);
        if (e.stderr) console.log(e.stderr);

        // Check if Sourcify succeeded
        if (e.stdout && e.stdout.includes("Successfully verified")) {
            console.log("\n✅ Verification successful via Sourcify!");
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error:", error);
        process.exit(1);
    });

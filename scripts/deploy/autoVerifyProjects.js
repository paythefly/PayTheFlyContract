/**
 * Auto-verify new Factory-created Project Contracts
 *
 * This script monitors ProjectCreated events and automatically verifies new contracts.
 *
 * Usage:
 *   NETWORK=bsc node scripts/deploy/autoVerifyProjects.js
 *   NETWORK=mainnet node scripts/deploy/autoVerifyProjects.js
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Network configurations
const NETWORKS = {
    bsc: {
        rpc: "https://bsc-dataseed1.binance.org",
        wss: "wss://bsc-ws-node.nariox.org:443",  // WebSocket for event listening
        chainId: 56,
        factory: "0xeaADa26c5B9E59ab3BBA1D50fA40813CbB40a65C",
        beacon: "0x41f8D4AB1f4F9062a531ABB66333E41C0BD2f0cC"
    },
    mainnet: {
        rpc: "https://ethereum-rpc.publicnode.com",
        wss: "wss://ethereum-rpc.publicnode.com",
        chainId: 1,
        factory: "0x6e92B74c5951bd38474B44eE59b7885B9e8F61F8",
        beacon: "0xc2fB47b16b9751B621E60AbB3c77a74322AC40C4"
    }
};

const FACTORY_ABI = [
    "event ProjectCreated(string indexed projectId, address indexed project, address indexed creator)"
];

async function verifyProject(projectAddr, networkName, network, projectArtifact) {
    const provider = new ethers.JsonRpcProvider(network.rpc);
    const project = new ethers.Contract(projectAddr, projectArtifact.abi, provider);

    try {
        // Wait a bit for the contract to be indexed
        await new Promise(r => setTimeout(r, 5000));

        const info = await project.getProjectInfo();
        const projectId = info[0];
        const name = info[1];
        const creator = info[2];
        const signer = info[3];
        const admin = info[5][0];

        console.log(`\n  Verifying project: ${projectAddr}`);
        console.log(`    projectId: ${projectId}`);
        console.log(`    name: ${name}`);

        // Generate initialize calldata
        const iface = new ethers.Interface(projectArtifact.abi);
        const initData = iface.encodeFunctionData("initialize", [
            projectId, name, creator, admin, signer
        ]);

        // Save constructor args
        const argsFile = path.join(__dirname, `temp-args-${projectAddr.slice(0, 10)}.js`);
        const argsContent = `module.exports = ["${network.beacon}", "${initData}"];`;
        fs.writeFileSync(argsFile, argsContent);

        // Run hardhat verify
        const cmd = `npx hardhat verify --network ${networkName} --contract "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol:BeaconProxy" --constructor-args ${argsFile} ${projectAddr}`;

        try {
            const result = execSync(cmd, {
                encoding: "utf-8",
                stdio: "pipe",
                cwd: path.join(__dirname, "../.."),
                timeout: 120000
            });

            if (result.includes("Successfully verified")) {
                console.log(`    ✅ Verified successfully`);
                logVerification(projectAddr, networkName, "success");
                return true;
            }
        } catch (e) {
            if (e.stdout && e.stdout.includes("Successfully verified")) {
                console.log(`    ✅ Verified via Sourcify`);
                logVerification(projectAddr, networkName, "success");
                return true;
            } else if (e.stdout && e.stdout.includes("Already Verified")) {
                console.log(`    ✅ Already verified`);
                logVerification(projectAddr, networkName, "already_verified");
                return true;
            } else {
                console.log(`    ❌ Verification failed`);
                logVerification(projectAddr, networkName, "failed", e.message);
                return false;
            }
        } finally {
            // Clean up temp file
            try { fs.unlinkSync(argsFile); } catch {}
        }
    } catch (e) {
        console.log(`    ❌ Error: ${e.message}`);
        logVerification(projectAddr, networkName, "error", e.message);
        return false;
    }
}

function logVerification(projectAddr, network, status, error = null) {
    const logFile = path.join(__dirname, `verification-log-${network}.json`);
    let logs = [];

    try {
        if (fs.existsSync(logFile)) {
            logs = JSON.parse(fs.readFileSync(logFile));
        }
    } catch {}

    logs.push({
        timestamp: new Date().toISOString(),
        project: projectAddr,
        status,
        error
    });

    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
}

async function main() {
    const networkName = process.env.NETWORK || "bsc";
    const network = NETWORKS[networkName];

    if (!network) {
        console.error("Unknown network:", networkName);
        process.exit(1);
    }

    console.log("========================================");
    console.log("Auto-Verify Project Monitor");
    console.log("========================================");
    console.log("Network:", networkName);
    console.log("Factory:", network.factory);
    console.log("Listening for ProjectCreated events...");
    console.log("");

    // Load PayTheFlyPro ABI
    const projectArtifact = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../../artifacts/contracts/PayTheFlyPro.sol/PayTheFlyPro.json"))
    );

    // Use HTTP polling instead of WebSocket (more reliable)
    const provider = new ethers.JsonRpcProvider(network.rpc);
    const factory = new ethers.Contract(network.factory, FACTORY_ABI, provider);

    // Get current block
    let lastBlock = await provider.getBlockNumber();
    console.log(`Starting from block: ${lastBlock}`);

    // Poll for new events every 15 seconds
    setInterval(async () => {
        try {
            const currentBlock = await provider.getBlockNumber();

            if (currentBlock > lastBlock) {
                const events = await factory.queryFilter(
                    factory.filters.ProjectCreated(),
                    lastBlock + 1,
                    currentBlock
                );

                for (const event of events) {
                    const projectAddr = event.args.project;
                    console.log(`\n[${new Date().toISOString()}] New project detected: ${projectAddr}`);

                    // Verify the new project
                    await verifyProject(projectAddr, networkName, network, projectArtifact);
                }

                lastBlock = currentBlock;
            }
        } catch (e) {
            console.error("Polling error:", e.message);
        }
    }, 15000);

    // Keep the process running
    console.log("\nMonitor is running. Press Ctrl+C to stop.");
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});

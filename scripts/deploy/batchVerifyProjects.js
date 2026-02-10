/**
 * Batch Verify Factory-created Project Contracts
 *
 * Usage:
 *   NETWORK=bsc node scripts/deploy/batchVerifyProjects.js
 *   NETWORK=mainnet node scripts/deploy/batchVerifyProjects.js
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
        beacon: "0x41f8D4AB1f4F9062a531ABB66333E41C0BD2f0cC",
        startBlock: 47000000  // Approximate factory deployment block
    },
    mainnet: {
        rpc: "https://ethereum-rpc.publicnode.com",
        chainId: 1,
        factory: "0x6e92B74c5951bd38474B44eE59b7885B9e8F61F8",
        beacon: "0xc2fB47b16b9751B621E60AbB3c77a74322AC40C4",
        startBlock: 21000000
    }
};

async function getProjectsFromEvents(provider, factoryAddr, startBlock) {
    console.log("Querying ProjectCreated events...");

    // ProjectCreated(string indexed projectId, address indexed project, address indexed creator)
    const eventSignature = "ProjectCreated(string,address,address)";
    const eventTopic = ethers.id(eventSignature);

    const currentBlock = await provider.getBlockNumber();
    const projects = [];

    // Query in chunks to avoid rate limiting
    const chunkSize = 10000;
    for (let fromBlock = startBlock; fromBlock < currentBlock; fromBlock += chunkSize) {
        const toBlock = Math.min(fromBlock + chunkSize - 1, currentBlock);

        try {
            const logs = await provider.getLogs({
                address: factoryAddr,
                topics: [eventTopic],
                fromBlock,
                toBlock
            });

            for (const log of logs) {
                // project address is in topics[2]
                const projectAddr = "0x" + log.topics[2].slice(26);
                projects.push(projectAddr);
            }

            if (logs.length > 0) {
                console.log(`  Found ${logs.length} projects in blocks ${fromBlock}-${toBlock}`);
            }
        } catch (e) {
            console.log(`  Error querying blocks ${fromBlock}-${toBlock}: ${e.message}`);
            // Wait and retry
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    return projects;
}

async function isContractVerified(projectAddr, networkName) {
    // Check via BscScan/Etherscan API if contract is verified
    // For now, we'll just try to verify all contracts
    return false;
}

async function verifyProject(projectAddr, networkName, network, projectArtifact) {
    const provider = new ethers.JsonRpcProvider(network.rpc);
    const project = new ethers.Contract(projectAddr, projectArtifact.abi, provider);

    try {
        const info = await project.getProjectInfo();
        const projectId = info[0];
        const name = info[1];
        const creator = info[2];
        const signer = info[3];
        const admin = info[5][0];

        console.log(`\n  Project: ${projectAddr}`);
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
                timeout: 60000
            });

            if (result.includes("Successfully verified")) {
                console.log(`    ✅ Verified successfully`);
                return true;
            }
        } catch (e) {
            if (e.stdout && e.stdout.includes("Successfully verified")) {
                console.log(`    ✅ Verified via Sourcify`);
                return true;
            } else if (e.stdout && e.stdout.includes("Already Verified")) {
                console.log(`    ✅ Already verified`);
                return true;
            } else {
                console.log(`    ❌ Verification failed`);
                return false;
            }
        } finally {
            // Clean up temp file
            try { fs.unlinkSync(argsFile); } catch {}
        }
    } catch (e) {
        console.log(`    ❌ Error: ${e.message}`);
        return false;
    }
}

async function main() {
    const networkName = process.env.NETWORK || "bsc";
    const network = NETWORKS[networkName];

    if (!network) {
        console.error("Unknown network:", networkName);
        process.exit(1);
    }

    console.log("========================================");
    console.log("Batch Verify Factory Projects");
    console.log("========================================");
    console.log("Network:", networkName);
    console.log("Factory:", network.factory);
    console.log("");

    const provider = new ethers.JsonRpcProvider(network.rpc);

    // Load PayTheFlyPro ABI
    const projectArtifact = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../../artifacts/contracts/PayTheFlyPro.sol/PayTheFlyPro.json"))
    );

    // Get all projects from events
    const projects = await getProjectsFromEvents(provider, network.factory, network.startBlock);

    console.log(`\nFound ${projects.length} total projects`);
    console.log("\n========================================");
    console.log("Verifying Projects...");
    console.log("========================================");

    let verified = 0;
    let failed = 0;

    for (const projectAddr of projects) {
        const success = await verifyProject(projectAddr, networkName, network, projectArtifact);
        if (success) verified++;
        else failed++;

        // Rate limiting
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log("\n========================================");
    console.log("Summary");
    console.log("========================================");
    console.log(`Total: ${projects.length}`);
    console.log(`Verified: ${verified}`);
    console.log(`Failed: ${failed}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error:", error);
        process.exit(1);
    });

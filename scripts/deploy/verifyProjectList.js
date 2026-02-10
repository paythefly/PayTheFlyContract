/**
 * Verify a list of Factory-created Project Contracts
 *
 * Usage:
 *   NETWORK=bsc node scripts/deploy/verifyProjectList.js
 *
 * Edit the PROJECT_LIST array below to add contracts to verify.
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ============================================
// ADD PROJECT ADDRESSES HERE
// ============================================
const PROJECT_LIST = [
    "0xd14571840b5323119291f3fc0a462acd0afa6b7a",  // UPB-BSC-PROD-01
    "0x68a7Ea783E6290FbdEEFE533642702213A9f3f21",  // no390
    // Add more project addresses below:
    // "0x...",
];
// ============================================

const NETWORKS = {
    bsc: {
        rpc: "https://bsc-dataseed1.binance.org",
        beacon: "0x41f8D4AB1f4F9062a531ABB66333E41C0BD2f0cC"
    },
    mainnet: {
        rpc: "https://ethereum-rpc.publicnode.com",
        beacon: "0xc2fB47b16b9751B621E60AbB3c77a74322AC40C4"
    }
};

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

        console.log(`\nProject: ${projectAddr}`);
        console.log(`  projectId: ${projectId}`);
        console.log(`  name: ${name}`);

        const iface = new ethers.Interface(projectArtifact.abi);
        const initData = iface.encodeFunctionData("initialize", [
            projectId, name, creator, admin, signer
        ]);

        const argsFile = path.join(__dirname, `temp-args.js`);
        fs.writeFileSync(argsFile, `module.exports = ["${network.beacon}", "${initData}"];`);

        const cmd = `npx hardhat verify --network ${networkName} --contract "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol:BeaconProxy" --constructor-args ${argsFile} ${projectAddr}`;

        try {
            execSync(cmd, { encoding: "utf-8", stdio: "pipe", cwd: path.join(__dirname, "../.."), timeout: 120000 });
            console.log(`  ✅ Verified`);
            return true;
        } catch (e) {
            if (e.stdout?.includes("Successfully verified") || e.stdout?.includes("Already Verified")) {
                console.log(`  ✅ Verified`);
                return true;
            }
            console.log(`  ❌ Failed: ${e.message?.slice(0, 100)}`);
            return false;
        } finally {
            try { fs.unlinkSync(argsFile); } catch {}
        }
    } catch (e) {
        console.log(`  ❌ Error: ${e.message}`);
        return false;
    }
}

async function main() {
    const networkName = process.env.NETWORK || "bsc";
    const network = NETWORKS[networkName];

    console.log("========================================");
    console.log("Verify Project List");
    console.log("========================================");
    console.log("Network:", networkName);
    console.log("Projects to verify:", PROJECT_LIST.length);

    const projectArtifact = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../../artifacts/contracts/PayTheFlyPro.sol/PayTheFlyPro.json"))
    );

    let success = 0, failed = 0;

    for (const addr of PROJECT_LIST) {
        const result = await verifyProject(addr, networkName, network, projectArtifact);
        result ? success++ : failed++;
        await new Promise(r => setTimeout(r, 3000)); // Rate limiting
    }

    console.log("\n========================================");
    console.log(`Done! Success: ${success}, Failed: ${failed}`);
}

main().catch(console.error);

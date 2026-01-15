/**
 * Create a new project using PayTheFlyProFactory
 *
 * Usage:
 *   FACTORY=0x... PROJECT_ID=myproject PROJECT_NAME="My Project" ADMIN=0x... SIGNER=0x... \
 *     npx hardhat run scripts/deploy/createProject.js --network localhost
 */

const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("========================================");
    console.log("Create New Project");
    console.log("========================================");
    console.log("Network:", network.name, `(chainId: ${network.chainId})`);
    console.log("Creator:", deployer.address);
    console.log("========================================\n");

    // Get configuration from environment
    const factoryAddress = process.env.FACTORY;
    const projectId = process.env.PROJECT_ID;
    const projectName = process.env.PROJECT_NAME || projectId;
    const adminAddress = process.env.ADMIN || deployer.address;
    const signerAddress = process.env.SIGNER || deployer.address;

    if (!factoryAddress) {
        throw new Error("FACTORY environment variable is required");
    }
    if (!projectId) {
        throw new Error("PROJECT_ID environment variable is required");
    }

    console.log("Configuration:");
    console.log("  Factory:", factoryAddress);
    console.log("  Project ID:", projectId);
    console.log("  Project Name:", projectName);
    console.log("  Admin:", adminAddress);
    console.log("  Signer:", signerAddress);
    console.log("");

    // Get factory contract
    const factory = await ethers.getContractAt("PayTheFlyProFactory", factoryAddress);

    // Check if project already exists
    const existingProject = await factory.getProject(projectId);
    if (existingProject !== ethers.ZeroAddress) {
        console.log("Project already exists at:", existingProject);
        return;
    }

    // Create project
    console.log("Creating project...");
    const tx = await factory.createProject(projectId, projectName, adminAddress, signerAddress);
    console.log("Transaction hash:", tx.hash);

    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt.blockNumber);

    // Get project address
    const projectAddress = await factory.getProject(projectId);
    console.log("\nProject created successfully!");
    console.log("Project Address:", projectAddress);

    // Verify project info
    const project = await ethers.getContractAt("PayTheFlyPro", projectAddress);
    const info = await project.getProjectInfo();

    console.log("\nProject Info:");
    console.log("  Project ID:", info.projectId);
    console.log("  Name:", info.name);
    console.log("  Creator:", info.creator);
    console.log("  Signer:", info.signer);
    console.log("  Paused:", info.paused);
    console.log("  Admins:", info.admins);
    console.log("  Threshold:", info.threshold.toString());

    // Summary
    console.log("\n========================================");
    console.log("Project Deployment Summary");
    console.log("========================================");
    console.log("Project ID:", projectId);
    console.log("Project Address:", projectAddress);
    console.log("Admin:", adminAddress);
    console.log("Signer:", signerAddress);
    console.log("========================================");

    return {
        projectId,
        projectAddress,
        admin: adminAddress,
        signer: signerAddress
    };
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

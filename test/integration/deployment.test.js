/**
 * Integration test for full deployment flow
 */

const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Deployment Integration Test", function () {
    let factory;
    let projectImpl;
    let owner;
    let admin;
    let signer;
    let feeVault;
    let user;

    const FEE_RATE = 100; // 1%

    describe("Full Deployment Flow", function () {
        it("Should deploy factory with beacon", async function () {
            [owner, admin, signer, feeVault, user] = await ethers.getSigners();

            // Deploy PayTheFlyPro implementation
            const PayTheFlyPro = await ethers.getContractFactory("PayTheFlyPro");
            projectImpl = await PayTheFlyPro.deploy();
            await projectImpl.waitForDeployment();

            // Deploy PayTheFlyProFactory with UUPS proxy
            const PayTheFlyProFactory = await ethers.getContractFactory("PayTheFlyProFactory");
            factory = await upgrades.deployProxy(
                PayTheFlyProFactory,
                [await projectImpl.getAddress(), feeVault.address, FEE_RATE],
                { kind: "uups" }
            );
            await factory.waitForDeployment();

            // Verify deployment
            expect(await factory.owner()).to.equal(owner.address);
            expect(await factory.feeVault()).to.equal(feeVault.address);
            expect(await factory.feeRate()).to.equal(FEE_RATE);
            expect(await factory.beacon()).to.not.equal(ethers.ZeroAddress);
        });

        it("Should create multiple projects", async function () {
            const projects = [];

            for (let i = 1; i <= 3; i++) {
                const projectId = `test-project-${i}`;
                const tx = await factory.createProject(
                    projectId,
                    `Test Project ${i}`,
                    admin.address,
                    signer.address
                );
                await tx.wait();

                const projectAddress = await factory.getProject(projectId);
                expect(projectAddress).to.not.equal(ethers.ZeroAddress);
                projects.push({ id: projectId, address: projectAddress });
            }

            expect(projects.length).to.equal(3);
        });

        it("Should process payments through projects", async function () {
            const projectAddress = await factory.getProject("test-project-1");
            const project = await ethers.getContractAt("PayTheFlyPro", projectAddress);

            // Create payment signature
            const amount = ethers.parseEther("1.0");
            const serialNo = "DEPLOY-TEST-001";
            const deadline = (await time.latest()) + 3600;

            const domain = {
                name: "PayTheFlyPro",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: projectAddress
            };

            const types = {
                Payment: [
                    { name: "payer", type: "address" },
                    { name: "token", type: "address" },
                    { name: "amount", type: "uint256" },
                    { name: "serialNo", type: "string" },
                    { name: "deadline", type: "uint256" }
                ]
            };

            const value = {
                payer: user.address,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signer.signTypedData(domain, types, value);

            // Process payment
            await project.connect(user).pay(
                { token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                signature,
                { value: amount }
            );

            // Verify balance
            const balance = await project.getBalance(ethers.ZeroAddress);
            expect(balance.paymentBalance).to.be.gt(0);
        });

        it("Should upgrade factory implementation", async function () {
            const oldImpl = await upgrades.erc1967.getImplementationAddress(await factory.getAddress());

            const PayTheFlyProFactoryV2 = await ethers.getContractFactory("PayTheFlyProFactory");
            const upgraded = await upgrades.upgradeProxy(await factory.getAddress(), PayTheFlyProFactoryV2);
            await upgraded.waitForDeployment();

            const newImpl = await upgrades.erc1967.getImplementationAddress(await factory.getAddress());

            // State should be preserved
            expect(await upgraded.owner()).to.equal(owner.address);
            expect(await upgraded.feeVault()).to.equal(feeVault.address);
            expect(await upgraded.feeRate()).to.equal(FEE_RATE);

            // Project should still exist
            const projectAddress = await upgraded.getProject("test-project-1");
            expect(projectAddress).to.not.equal(ethers.ZeroAddress);
        });

        it("Should upgrade beacon implementation", async function () {
            // Deploy new implementation
            const PayTheFlyProV2 = await ethers.getContractFactory("PayTheFlyPro");
            const newImpl = await PayTheFlyProV2.deploy();
            await newImpl.waitForDeployment();

            // Get beacon
            const beaconAddress = await factory.beacon();
            const beacon = await ethers.getContractAt("UpgradeableBeacon", beaconAddress);
            const oldImpl = await beacon.implementation();

            // Upgrade via factory
            await factory.upgradeBeacon(await newImpl.getAddress());

            const updatedImpl = await beacon.implementation();
            expect(updatedImpl).to.equal(await newImpl.getAddress());
            expect(updatedImpl).to.not.equal(oldImpl);

            // Existing project should still work
            const projectAddress = await factory.getProject("test-project-1");
            const project = await ethers.getContractAt("PayTheFlyPro", projectAddress);

            const info = await project.getProjectInfo();
            expect(info.projectId).to.equal("test-project-1");
        });

        it("Should handle two-step ownership transfer", async function () {
            // Initiate transfer
            await factory.transferOwnership(admin.address);
            expect(await factory.pendingOwner()).to.equal(admin.address);
            expect(await factory.owner()).to.equal(owner.address);

            // Accept transfer
            await factory.connect(admin).acceptOwnership();
            expect(await factory.owner()).to.equal(admin.address);
            expect(await factory.pendingOwner()).to.equal(ethers.ZeroAddress);

            // Transfer back for cleanup
            await factory.connect(admin).transferOwnership(owner.address);
            await factory.connect(owner).acceptOwnership();
        });

        it("Should execute multi-sig proposal flow", async function () {
            const projectAddress = await factory.getProject("test-project-1");
            const project = await ethers.getContractAt("PayTheFlyPro", projectAddress);

            // Add second admin
            const deadline = (await time.latest()) + 86400;
            const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [owner.address]);

            const tx = await project.connect(admin).createProposal(1, params, deadline); // AddAdmin
            await tx.wait();

            // Execute (threshold is 1)
            await project.connect(admin).executeProposal(0);

            // Verify admin was added
            expect(await project.isAdmin(owner.address)).to.be.true;
        });
    });

    describe("Gas Estimation", function () {
        it("Should estimate factory deployment gas", async function () {
            const PayTheFlyPro = await ethers.getContractFactory("PayTheFlyPro");
            const deployTx = await PayTheFlyPro.getDeployTransaction();
            const estimatedGas = await ethers.provider.estimateGas(deployTx);
            console.log("    PayTheFlyPro deployment gas:", estimatedGas.toString());
            expect(estimatedGas).to.be.lt(5000000);
        });

        it("Should estimate project creation gas", async function () {
            const gas = await factory.createProject.estimateGas(
                "gas-test-project",
                "Gas Test",
                admin.address,
                signer.address
            );
            console.log("    Project creation gas:", gas.toString());
            expect(gas).to.be.lt(1000000);
        });
    });
});

const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("PayTheFlyProFactory", function () {
    let factory;
    let projectImpl;
    let owner;
    let admin;
    let signer;
    let feeVault;
    let user;

    const FEE_RATE = 100; // 1%

    beforeEach(async function () {
        [owner, admin, signer, feeVault, user] = await ethers.getSigners();

        // Deploy Project implementation
        const Project = await ethers.getContractFactory("PayTheFlyPro");
        projectImpl = await Project.deploy();
        await projectImpl.waitForDeployment();

        // Deploy PayTheFlyProFactory with UUPS proxy
        const PayTheFlyProFactory = await ethers.getContractFactory("PayTheFlyProFactory");
        factory = await upgrades.deployProxy(
            PayTheFlyProFactory,
            [
                await projectImpl.getAddress(),
                feeVault.address,
                FEE_RATE
            ],
            { kind: "uups" }
        );
        await factory.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should set the correct owner", async function () {
            expect(await factory.owner()).to.equal(owner.address);
        });

        it("Should set the correct fee vault", async function () {
            expect(await factory.feeVault()).to.equal(feeVault.address);
        });

        it("Should set the correct fee rate", async function () {
            expect(await factory.feeRate()).to.equal(FEE_RATE);
        });

        it("Should deploy a beacon", async function () {
            const beaconAddress = await factory.beacon();
            expect(beaconAddress).to.not.equal(ethers.ZeroAddress);
        });

        it("Should revert with invalid fee vault", async function () {
            const PayTheFlyProFactory = await ethers.getContractFactory("PayTheFlyProFactory");
            await expect(
                upgrades.deployProxy(
                    PayTheFlyProFactory,
                    [await projectImpl.getAddress(), ethers.ZeroAddress, FEE_RATE],
                    { kind: "uups" }
                )
            ).to.be.revertedWithCustomError(factory, "InvalidFeeVault");
        });

        it("Should revert with fee rate too high", async function () {
            const PayTheFlyProFactory = await ethers.getContractFactory("PayTheFlyProFactory");
            await expect(
                upgrades.deployProxy(
                    PayTheFlyProFactory,
                    [await projectImpl.getAddress(), feeVault.address, 1001], // > 10%
                    { kind: "uups" }
                )
            ).to.be.revertedWithCustomError(factory, "FeeRateTooHigh");
        });
    });

    describe("Create Project", function () {
        const projectId = "project-001";
        const projectName = "Test Project";

        it("Should create a new project", async function () {
            const tx = await factory.createProject(
                projectId,
                projectName,
                admin.address,
                signer.address
            );
            const receipt = await tx.wait();

            // Get project address from event
            const event = receipt.logs.find(log => {
                try {
                    return factory.interface.parseLog(log)?.name === "ProjectCreated";
                } catch {
                    return false;
                }
            });
            expect(event).to.not.be.undefined;

            const parsedEvent = factory.interface.parseLog(event);
            // Note: indexed string is hashed, so we check the hash
            expect(parsedEvent.args.projectId.hash).to.equal(ethers.id(projectId));
            expect(parsedEvent.args.admin).to.equal(admin.address);
            expect(parsedEvent.args.name).to.equal(projectName);
        });

        it("Should store project address in mapping", async function () {
            await factory.createProject(projectId, projectName, admin.address, signer.address);
            const projectAddress = await factory.getProject(projectId);
            expect(projectAddress).to.not.equal(ethers.ZeroAddress);
        });

        it("Should mark project as existing", async function () {
            await factory.createProject(projectId, projectName, admin.address, signer.address);
            expect(await factory.projectExists(projectId)).to.be.true;
        });

        it("Should revert with empty project ID", async function () {
            await expect(
                factory.createProject("", projectName, admin.address, signer.address)
            ).to.be.revertedWithCustomError(factory, "ProjectIdEmpty");
        });

        it("Should revert with project ID too long", async function () {
            const longId = "a".repeat(129);
            await expect(
                factory.createProject(longId, projectName, admin.address, signer.address)
            ).to.be.revertedWithCustomError(factory, "ProjectIdTooLong");
        });

        it("Should revert with duplicate project ID", async function () {
            await factory.createProject(projectId, projectName, admin.address, signer.address);
            await expect(
                factory.createProject(projectId, "Another Project", admin.address, signer.address)
            ).to.be.revertedWithCustomError(factory, "ProjectAlreadyExists");
        });

        it("Should revert with invalid admin address", async function () {
            await expect(
                factory.createProject(projectId, projectName, ethers.ZeroAddress, signer.address)
            ).to.be.revertedWithCustomError(factory, "InvalidAdminAddress");
        });

        it("Should revert with invalid signer address", async function () {
            const Errors = await ethers.getContractFactory("contracts/libraries/Errors.sol:Errors");
            await expect(
                factory.createProject(projectId, projectName, admin.address, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(Errors, "InvalidSignerAddress");
        });

        it("Should initialize project correctly", async function () {
            await factory.createProject(projectId, projectName, admin.address, signer.address);
            const projectAddress = await factory.getProject(projectId);

            const Project = await ethers.getContractFactory("PayTheFlyPro");
            const project = Project.attach(projectAddress);

            const info = await project.getProjectInfo();
            expect(info.projectId).to.equal(projectId);
            expect(info.name).to.equal(projectName);
            expect(info.creator).to.equal(owner.address);
            expect(info.signer).to.equal(signer.address);
            expect(info.paused).to.be.false;
            expect(info.admins).to.deep.equal([admin.address]);
            expect(info.threshold).to.equal(1);
        });

        it("Should allow anyone to create a project", async function () {
            await expect(
                factory.connect(user).createProject(projectId, projectName, admin.address, signer.address)
            ).to.not.be.reverted;
        });
    });

    describe("Admin Functions", function () {
        it("Should update fee vault", async function () {
            const newVault = user.address;
            await expect(factory.setFeeVault(newVault))
                .to.emit(factory, "FeeVaultUpdated")
                .withArgs(feeVault.address, newVault);
            expect(await factory.feeVault()).to.equal(newVault);
        });

        it("Should revert setFeeVault with zero address", async function () {
            await expect(
                factory.setFeeVault(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(factory, "InvalidFeeVault");
        });

        it("Should revert setFeeVault from non-owner", async function () {
            await expect(
                factory.connect(user).setFeeVault(user.address)
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
        });

        it("Should update fee rate", async function () {
            const newRate = 200; // 2%
            await expect(factory.setFeeRate(newRate))
                .to.emit(factory, "FeeRateUpdated")
                .withArgs(FEE_RATE, newRate);
            expect(await factory.feeRate()).to.equal(newRate);
        });

        it("Should revert setFeeRate too high", async function () {
            await expect(
                factory.setFeeRate(1001)
            ).to.be.revertedWithCustomError(factory, "FeeRateTooHigh");
        });

        it("Should revert setFeeRate from non-owner", async function () {
            await expect(
                factory.connect(user).setFeeRate(200)
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
        });
    });

    describe("Ownership Transfer (Two-Step)", function () {
        it("Should initiate ownership transfer", async function () {
            await factory.transferOwnership(user.address);
            expect(await factory.pendingOwner()).to.equal(user.address);
            expect(await factory.owner()).to.equal(owner.address); // Still owner
        });

        it("Should complete ownership transfer", async function () {
            await factory.transferOwnership(user.address);
            await factory.connect(user).acceptOwnership();
            expect(await factory.owner()).to.equal(user.address);
            expect(await factory.pendingOwner()).to.equal(ethers.ZeroAddress);
        });

        it("Should cancel ownership transfer", async function () {
            await factory.transferOwnership(user.address);
            await factory.cancelOwnershipTransfer();
            expect(await factory.pendingOwner()).to.equal(ethers.ZeroAddress);
        });

        it("Should revert acceptOwnership from non-pending owner", async function () {
            await factory.transferOwnership(user.address);
            await expect(
                factory.connect(admin).acceptOwnership()
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
        });
    });

    describe("Beacon Upgrade", function () {
        it("Should upgrade beacon implementation", async function () {
            // Deploy new implementation
            const ProjectV2 = await ethers.getContractFactory("PayTheFlyPro");
            const projectImplV2 = await ProjectV2.deploy();
            await projectImplV2.waitForDeployment();

            const oldImpl = await projectImpl.getAddress();
            const newImpl = await projectImplV2.getAddress();

            await expect(factory.upgradeBeacon(newImpl))
                .to.emit(factory, "BeaconUpgraded")
                .withArgs(oldImpl, newImpl);
        });

        it("Should revert upgradeBeacon from non-owner", async function () {
            const ProjectV2 = await ethers.getContractFactory("PayTheFlyPro");
            const projectImplV2 = await ProjectV2.deploy();
            await projectImplV2.waitForDeployment();

            await expect(
                factory.connect(user).upgradeBeacon(await projectImplV2.getAddress())
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
        });
    });

    describe("Factory Upgrade (UUPS)", function () {
        it("Should upgrade factory implementation", async function () {
            const PayTheFlyProFactoryV2 = await ethers.getContractFactory("PayTheFlyProFactory");
            const upgraded = await upgrades.upgradeProxy(factory, PayTheFlyProFactoryV2);

            // Verify state is preserved
            expect(await upgraded.feeVault()).to.equal(feeVault.address);
            expect(await upgraded.feeRate()).to.equal(FEE_RATE);
        });

        it("Should revert upgrade from non-owner", async function () {
            const PayTheFlyProFactoryV2 = await ethers.getContractFactory("PayTheFlyProFactory", user);
            await expect(
                upgrades.upgradeProxy(await factory.getAddress(), PayTheFlyProFactoryV2)
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
        });
    });
});

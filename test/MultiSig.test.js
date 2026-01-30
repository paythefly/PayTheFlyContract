const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MultiSig", function () {
    let factory;
    let project;
    let owner;
    let admin1;
    let admin2;
    let admin3;
    let projectSigner;
    let feeVault;
    let user;
    let recipient;

    const FEE_RATE = 100;
    const projectId = "multisig-test";
    const projectName = "MultiSig Test";

    // Operation types
    const OperationType = {
        SetSigner: 0,
        AddAdmin: 1,
        RemoveAdmin: 2,
        ChangeThreshold: 3,
        AdminWithdraw: 4,
        WithdrawFromPool: 5,
        Pause: 6,
        Unpause: 7,
        EmergencyWithdraw: 8
    };

    beforeEach(async function () {
        [owner, admin1, admin2, admin3, projectSigner, feeVault, user, recipient] = await ethers.getSigners();

        // Deploy Project implementation
        const Project = await ethers.getContractFactory("PayTheFlyPro");
        const projectImpl = await Project.deploy();
        await projectImpl.waitForDeployment();

        // Deploy PayTheFlyProFactory
        const PayTheFlyProFactory = await ethers.getContractFactory("PayTheFlyProFactory");
        factory = await upgrades.deployProxy(
            PayTheFlyProFactory,
            [await projectImpl.getAddress(), feeVault.address, FEE_RATE],
            { kind: "uups" }
        );
        await factory.waitForDeployment();

        // Create project with admin1
        await factory.createProject(projectId, projectName, admin1.address, projectSigner.address);
        const projectAddress = await factory.getProject(projectId);
        project = await ethers.getContractAt("PayTheFlyPro", projectAddress);
    });

    describe("Proposal Creation", function () {
        it("Should create a proposal", async function () {
            const deadline = (await time.latest()) + 86400; // 24 hours
            const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);

            const tx = await project.connect(admin1).createProposal(
                OperationType.AddAdmin,
                params,
                deadline
            );
            const receipt = await tx.wait();

            const event = receipt.logs.find(log => {
                try {
                    return project.interface.parseLog(log)?.name === "ProposalCreated";
                } catch {
                    return false;
                }
            });

            expect(event).to.not.be.undefined;
            const parsedEvent = project.interface.parseLog(event);
            expect(parsedEvent.args.opType).to.equal(OperationType.AddAdmin);
        });

        it("Should auto-confirm on creation", async function () {
            const deadline = (await time.latest()) + 86400;
            const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);

            await project.connect(admin1).createProposal(OperationType.AddAdmin, params, deadline);

            const proposal = await project.getProposal(0);
            expect(proposal.confirmCount).to.equal(1);
            expect(await project.hasConfirmed(0, admin1.address)).to.be.true;
        });

        it("Should reject proposal from non-admin", async function () {
            const deadline = (await time.latest()) + 86400;
            const params = "0x";

            await expect(
                project.connect(user).createProposal(OperationType.Pause, params, deadline)
            ).to.be.revertedWithCustomError(project, "NotAdmin");
        });

        it("Should reject proposal with deadline too short", async function () {
            const deadline = (await time.latest()) + 1800; // 30 minutes (< 1 hour)
            const params = "0x";

            await expect(
                project.connect(admin1).createProposal(OperationType.Pause, params, deadline)
            ).to.be.revertedWithCustomError(project, "InvalidProposalDuration");
        });

        it("Should reject proposal with deadline too long", async function () {
            const deadline = (await time.latest()) + 31 * 86400; // > 30 days
            const params = "0x";

            await expect(
                project.connect(admin1).createProposal(OperationType.Pause, params, deadline)
            ).to.be.revertedWithCustomError(project, "InvalidProposalDuration");
        });
    });

    describe("Proposal Confirmation", function () {
        let proposalId;

        beforeEach(async function () {
            // First add admin2 so we can test multi-sig
            const deadline = (await time.latest()) + 86400;
            const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);
            await project.connect(admin1).createProposal(OperationType.AddAdmin, params, deadline);
            await project.connect(admin1).executeProposal(0);

            // Set threshold to 2
            const thresholdParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [2]);
            await project.connect(admin1).createProposal(OperationType.ChangeThreshold, thresholdParams, deadline);
            await project.connect(admin2).confirmProposal(1);
            await project.connect(admin1).executeProposal(1);

            // Create a new proposal that needs 2 confirmations
            await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);
            proposalId = 2;
        });

        it("Should confirm proposal", async function () {
            await expect(project.connect(admin2).confirmProposal(proposalId))
                .to.emit(project, "ProposalConfirmed")
                .withArgs(proposalId, admin2.address);

            const proposal = await project.getProposal(proposalId);
            expect(proposal.confirmCount).to.equal(2);
        });

        it("Should reject double confirmation", async function () {
            await expect(
                project.connect(admin1).confirmProposal(proposalId)
            ).to.be.revertedWithCustomError(project, "AlreadyConfirmed");
        });

        it("Should reject confirmation from non-admin", async function () {
            await expect(
                project.connect(user).confirmProposal(proposalId)
            ).to.be.revertedWithCustomError(project, "NotAdmin");
        });

        it("Should reject confirmation for non-existent proposal", async function () {
            await expect(
                project.connect(admin2).confirmProposal(999)
            ).to.be.revertedWithCustomError(project, "ProposalNotFound");
        });

        it("Should reject confirmation for expired proposal", async function () {
            await time.increase(86401); // > 24 hours

            await expect(
                project.connect(admin2).confirmProposal(proposalId)
            ).to.be.revertedWithCustomError(project, "ProposalExpired");
        });
    });

    describe("Proposal Revocation", function () {
        let proposalId;

        beforeEach(async function () {
            // Add admin2
            const deadline = (await time.latest()) + 86400;
            const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);
            await project.connect(admin1).createProposal(OperationType.AddAdmin, params, deadline);
            await project.connect(admin1).executeProposal(0);

            // Create proposal
            await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);
            proposalId = 1;
        });

        it("Should revoke confirmation", async function () {
            await expect(project.connect(admin1).revokeConfirmation(proposalId))
                .to.emit(project, "ProposalRevoked")
                .withArgs(proposalId, admin1.address);

            const proposal = await project.getProposal(proposalId);
            expect(proposal.confirmCount).to.equal(0);
        });

        it("Should reject revocation without confirmation", async function () {
            await expect(
                project.connect(admin2).revokeConfirmation(proposalId)
            ).to.be.revertedWithCustomError(project, "NotConfirmed");
        });
    });

    describe("Proposal Cancellation", function () {
        let proposalId;

        beforeEach(async function () {
            const deadline = (await time.latest()) + 86400;
            await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);
            proposalId = 0;
        });

        it("Should cancel proposal by proposer", async function () {
            await expect(project.connect(admin1).cancelProposal(proposalId))
                .to.emit(project, "ProposalCancelled")
                .withArgs(proposalId);

            const proposal = await project.getProposal(proposalId);
            expect(proposal.cancelled).to.be.true;
        });

        it("Should reject cancellation by non-proposer", async function () {
            // First add admin2
            const deadline = (await time.latest()) + 86400;
            const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);
            await project.connect(admin1).createProposal(OperationType.AddAdmin, params, deadline);
            await project.connect(admin1).executeProposal(1);

            await expect(
                project.connect(admin2).cancelProposal(proposalId)
            ).to.be.revertedWithCustomError(project, "NotProposer");
        });

        it("Should reject execution of cancelled proposal", async function () {
            await project.connect(admin1).cancelProposal(proposalId);

            await expect(
                project.connect(admin1).executeProposal(proposalId)
            ).to.be.revertedWithCustomError(project, "ProposalCancelledError");
        });
    });

    describe("Proposal Execution", function () {
        it("Should execute when threshold reached", async function () {
            const deadline = (await time.latest()) + 86400;
            await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);

            await expect(project.connect(admin1).executeProposal(0))
                .to.emit(project, "ProposalExecuted")
                .withArgs(0)
                .and.to.emit(project, "ProjectPaused");

            const info = await project.getProjectInfo();
            expect(info.paused).to.be.true;
        });

        it("Should reject execution without threshold", async function () {
            // Add admin2 and set threshold to 2
            const deadline = (await time.latest()) + 86400;
            const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);
            await project.connect(admin1).createProposal(OperationType.AddAdmin, params, deadline);
            await project.connect(admin1).executeProposal(0);

            const thresholdParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [2]);
            await project.connect(admin1).createProposal(OperationType.ChangeThreshold, thresholdParams, deadline);
            await project.connect(admin2).confirmProposal(1);
            await project.connect(admin1).executeProposal(1);

            // Create pause proposal (needs 2 confirmations now)
            await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);

            await expect(
                project.connect(admin1).executeProposal(2)
            ).to.be.revertedWithCustomError(project, "ThresholdNotReached");
        });

        it("Should reject double execution", async function () {
            const deadline = (await time.latest()) + 86400;
            await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);
            await project.connect(admin1).executeProposal(0);

            await expect(
                project.connect(admin1).executeProposal(0)
            ).to.be.revertedWithCustomError(project, "ProposalAlreadyExecuted");
        });

        it("Should reject execution of expired proposal", async function () {
            const deadline = (await time.latest()) + 3700; // Slightly more than 1 hour minimum
            await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);

            await time.increase(3701); // Past deadline

            await expect(
                project.connect(admin1).executeProposal(0)
            ).to.be.revertedWithCustomError(project, "ProposalExpired");
        });
    });

    describe("Admin Management Operations", function () {
        describe("AddAdmin", function () {
            it("Should add new admin", async function () {
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);

                await project.connect(admin1).createProposal(OperationType.AddAdmin, params, deadline);
                await project.connect(admin1).executeProposal(0);

                expect(await project.isAdmin(admin2.address)).to.be.true;
                const admins = await project.getAdmins();
                expect(admins).to.include(admin2.address);
            });

            it("Should reject adding existing admin", async function () {
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin1.address]);

                await project.connect(admin1).createProposal(OperationType.AddAdmin, params, deadline);

                await expect(
                    project.connect(admin1).executeProposal(0)
                ).to.be.revertedWithCustomError(project, "AdminAlreadyExists");
            });

            it("Should reject adding zero address", async function () {
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ethers.ZeroAddress]);

                await project.connect(admin1).createProposal(OperationType.AddAdmin, params, deadline);

                await expect(
                    project.connect(admin1).executeProposal(0)
                ).to.be.revertedWithCustomError(project, "InvalidAddress");
            });

            it("Should reject exceeding max admins", async function () {
                const deadline = (await time.latest()) + 86400;

                // Add 19 more admins (total 20)
                for (let i = 0; i < 19; i++) {
                    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
                    const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [wallet.address]);
                    await project.connect(admin1).createProposal(OperationType.AddAdmin, params, deadline);
                    await project.connect(admin1).executeProposal(i);
                }

                // Try to add 21st admin
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);
                await project.connect(admin1).createProposal(OperationType.AddAdmin, params, deadline);

                await expect(
                    project.connect(admin1).executeProposal(19)
                ).to.be.revertedWithCustomError(project, "MaxAdminsReached");
            });
        });

        describe("RemoveAdmin", function () {
            beforeEach(async function () {
                // Add admin2 first
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);
                await project.connect(admin1).createProposal(OperationType.AddAdmin, params, deadline);
                await project.connect(admin1).executeProposal(0);
            });

            it("Should remove admin", async function () {
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);

                await project.connect(admin1).createProposal(OperationType.RemoveAdmin, params, deadline);
                await project.connect(admin1).executeProposal(1);

                expect(await project.isAdmin(admin2.address)).to.be.false;
            });

            it("Should reject removing non-existent admin", async function () {
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user.address]);

                await project.connect(admin1).createProposal(OperationType.RemoveAdmin, params, deadline);

                await expect(
                    project.connect(admin1).executeProposal(1)
                ).to.be.revertedWithCustomError(project, "AdminNotFound");
            });

            it("Should reject if removal would violate threshold", async function () {
                const deadline = (await time.latest()) + 86400;

                // Set threshold to 2
                const thresholdParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [2]);
                await project.connect(admin1).createProposal(OperationType.ChangeThreshold, thresholdParams, deadline);
                await project.connect(admin2).confirmProposal(1);
                await project.connect(admin1).executeProposal(1);

                // Try to remove admin (would leave 1 admin with threshold 2)
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);
                await project.connect(admin1).createProposal(OperationType.RemoveAdmin, params, deadline);
                await project.connect(admin2).confirmProposal(2);

                await expect(
                    project.connect(admin1).executeProposal(2)
                ).to.be.revertedWithCustomError(project, "ThresholdTooHigh");
            });
        });

        describe("ChangeThreshold", function () {
            beforeEach(async function () {
                // Add admin2
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);
                await project.connect(admin1).createProposal(OperationType.AddAdmin, params, deadline);
                await project.connect(admin1).executeProposal(0);
            });

            it("Should change threshold", async function () {
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [2]);

                await project.connect(admin1).createProposal(OperationType.ChangeThreshold, params, deadline);
                await project.connect(admin1).executeProposal(1);

                expect(await project.getThreshold()).to.equal(2);
            });

            it("Should reject threshold of 0", async function () {
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0]);

                await project.connect(admin1).createProposal(OperationType.ChangeThreshold, params, deadline);

                await expect(
                    project.connect(admin1).executeProposal(1)
                ).to.be.revertedWithCustomError(project, "InvalidThreshold");
            });

            it("Should reject threshold higher than admin count", async function () {
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [3]); // Only 2 admins

                await project.connect(admin1).createProposal(OperationType.ChangeThreshold, params, deadline);

                await expect(
                    project.connect(admin1).executeProposal(1)
                ).to.be.revertedWithCustomError(project, "InvalidThreshold");
            });
        });

        describe("SetSigner", function () {
            it("Should update signer", async function () {
                const newSigner = user.address;
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [newSigner]);

                await project.connect(admin1).createProposal(OperationType.SetSigner, params, deadline);
                await project.connect(admin1).executeProposal(0);

                const info = await project.getProjectInfo();
                expect(info.signer).to.equal(newSigner);
            });

            it("Should reject zero address signer", async function () {
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ethers.ZeroAddress]);

                await project.connect(admin1).createProposal(OperationType.SetSigner, params, deadline);

                await expect(
                    project.connect(admin1).executeProposal(0)
                ).to.be.revertedWithCustomError(project, "InvalidAddress");
            });
        });
    });

    describe("Fund Operations", function () {
        beforeEach(async function () {
            // Fund the project with ETH via depositToWithdrawalPool
            // Direct ETH transfer is not allowed
            const amount = ethers.parseEther("10");
            await project.connect(admin1).depositToWithdrawalPool(ethers.ZeroAddress, 0, { value: amount });
        });

        describe("AdminWithdraw (from payment pool)", function () {
            // This test needs actual payment balance, which requires signatures
            // Skip for now as payment tests cover the balance accumulation
        });

        describe("WithdrawFromPool", function () {
            it("Should withdraw from withdrawal pool", async function () {
                const withdrawAmount = ethers.parseEther("5");
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "uint256", "address"],
                    [ethers.ZeroAddress, withdrawAmount, recipient.address]
                );

                const balanceBefore = await ethers.provider.getBalance(recipient.address);

                await project.connect(admin1).createProposal(OperationType.WithdrawFromPool, params, deadline);
                await project.connect(admin1).executeProposal(0);

                const balanceAfter = await ethers.provider.getBalance(recipient.address);
                expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
            });
        });

        describe("EmergencyWithdraw", function () {
            it("Should emergency withdraw all funds", async function () {
                const deadline = (await time.latest()) + 86400;
                const params = ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "address"],
                    [ethers.ZeroAddress, recipient.address]
                );

                const balanceBefore = await ethers.provider.getBalance(recipient.address);

                await project.connect(admin1).createProposal(OperationType.EmergencyWithdraw, params, deadline);
                await project.connect(admin1).executeProposal(0);

                const balanceAfter = await ethers.provider.getBalance(recipient.address);
                expect(balanceAfter).to.be.gt(balanceBefore);

                // Check both pools are empty
                const balance = await project.getBalance(ethers.ZeroAddress);
                expect(balance.paymentBalance).to.equal(0);
                expect(balance.withdrawalBalance).to.equal(0);
            });
        });
    });

    describe("Pause/Unpause", function () {
        it("Should pause and unpause project", async function () {
            const deadline = (await time.latest()) + 86400;

            // Pause
            await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);
            await project.connect(admin1).executeProposal(0);

            let info = await project.getProjectInfo();
            expect(info.paused).to.be.true;

            // Unpause
            await project.connect(admin1).createProposal(OperationType.Unpause, "0x", deadline);
            await project.connect(admin1).executeProposal(1);

            info = await project.getProjectInfo();
            expect(info.paused).to.be.false;
        });
    });

    describe("Proposal Queries", function () {
        it("Should get paginated proposals (newest first)", async function () {
            const deadline = (await time.latest()) + 86400;

            // Create 5 proposals
            for (let i = 0; i < 5; i++) {
                await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);
            }

            // Get first page (2 items)
            const { proposals, total } = await project.getProposalsPaginated(0, 2);
            expect(total).to.equal(5);
            expect(proposals.length).to.equal(2);
            expect(proposals[0].id).to.equal(4); // Newest first
            expect(proposals[1].id).to.equal(3);

            // Get second page
            const page2 = await project.getProposalsPaginated(2, 2);
            expect(page2.proposals.length).to.equal(2);
            expect(page2.proposals[0].id).to.equal(2);
            expect(page2.proposals[1].id).to.equal(1);
        });

        it("Should return empty for out of range offset", async function () {
            const deadline = (await time.latest()) + 86400;
            await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);

            const { proposals, total } = await project.getProposalsPaginated(10, 5);
            expect(proposals.length).to.equal(0);
            expect(total).to.equal(1);
        });

        it("Should get proposal count", async function () {
            const deadline = (await time.latest()) + 86400;
            expect(await project.getProposalCount()).to.equal(0);

            await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);
            expect(await project.getProposalCount()).to.equal(1);
        });
    });

    describe("Removed Admin Confirmation Fix", function () {
        it("Should not count removed admin's confirmation when executing proposal", async function () {
            const deadline = (await time.latest()) + 86400;

            // Step 1: Add admin2 and admin3
            const addAdmin2Params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);
            await project.connect(admin1).createProposal(OperationType.AddAdmin, addAdmin2Params, deadline);
            await project.connect(admin1).executeProposal(0);

            const addAdmin3Params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin3.address]);
            await project.connect(admin1).createProposal(OperationType.AddAdmin, addAdmin3Params, deadline);
            await project.connect(admin1).executeProposal(1);

            // Step 2: Set threshold to 2
            const thresholdParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [2]);
            await project.connect(admin1).createProposal(OperationType.ChangeThreshold, thresholdParams, deadline);
            await project.connect(admin2).confirmProposal(2);
            await project.connect(admin1).executeProposal(2);

            expect(await project.getThreshold()).to.equal(2);

            // Step 3: Create a Pause proposal - admin1 confirms (auto), admin2 confirms
            await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);
            const pauseProposalId = 3;
            await project.connect(admin2).confirmProposal(pauseProposalId);

            // At this point, confirmCount = 2 (admin1 + admin2)
            let proposal = await project.getProposal(pauseProposalId);
            expect(proposal.confirmCount).to.equal(2);

            // Step 4: Remove admin2
            const removeAdmin2Params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);
            await project.connect(admin1).createProposal(OperationType.RemoveAdmin, removeAdmin2Params, deadline);
            await project.connect(admin3).confirmProposal(4);
            await project.connect(admin1).executeProposal(4);

            expect(await project.isAdmin(admin2.address)).to.be.false;

            // Step 5: Check the Pause proposal's active confirm count
            // The fix ensures only current admins' confirmations are counted
            proposal = await project.getProposal(pauseProposalId);
            // After fix: confirmCount should be 1 (only admin1, admin2 is removed)
            expect(proposal.confirmCount).to.equal(1);

            // Step 6: Attempting to execute should fail (1 < threshold of 2)
            await expect(
                project.connect(admin1).executeProposal(pauseProposalId)
            ).to.be.revertedWithCustomError(project, "ThresholdNotReached");

            // Step 7: admin3 confirms, now it should have 2 confirmations
            await project.connect(admin3).confirmProposal(pauseProposalId);

            proposal = await project.getProposal(pauseProposalId);
            expect(proposal.confirmCount).to.equal(2);

            // Step 8: Now execution should succeed
            await expect(project.connect(admin1).executeProposal(pauseProposalId))
                .to.emit(project, "ProposalExecuted")
                .withArgs(pauseProposalId);

            const info = await project.getProjectInfo();
            expect(info.paused).to.be.true;
        });

        it("Should return correct confirmedBy list excluding removed admin", async function () {
            const deadline = (await time.latest()) + 86400;

            // Add admin2
            const addAdmin2Params = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);
            await project.connect(admin1).createProposal(OperationType.AddAdmin, addAdmin2Params, deadline);
            await project.connect(admin1).executeProposal(0);

            // Create Pause proposal - admin1 and admin2 both confirm
            await project.connect(admin1).createProposal(OperationType.Pause, "0x", deadline);
            await project.connect(admin2).confirmProposal(1);

            let proposal = await project.getProposal(1);
            expect(proposal.confirmedBy).to.include(admin1.address);
            expect(proposal.confirmedBy).to.include(admin2.address);
            expect(proposal.confirmedBy.length).to.equal(2);

            // Remove admin2
            const removeParams = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [admin2.address]);
            await project.connect(admin1).createProposal(OperationType.RemoveAdmin, removeParams, deadline);
            await project.connect(admin1).executeProposal(2);

            // Check confirmedBy no longer includes admin2
            proposal = await project.getProposal(1);
            expect(proposal.confirmedBy).to.include(admin1.address);
            expect(proposal.confirmedBy).to.not.include(admin2.address);
            expect(proposal.confirmedBy.length).to.equal(1);
        });
    });

    describe("Admin Functions (No Multi-Sig)", function () {
        it("Should set name without multi-sig", async function () {
            const newName = "Updated Project Name";
            await expect(project.connect(admin1).setName(newName))
                .to.emit(project, "ProjectNameUpdated");

            const info = await project.getProjectInfo();
            expect(info.name).to.equal(newName);
        });

        it("Should reject setName from non-admin", async function () {
            await expect(
                project.connect(user).setName("New Name")
            ).to.be.revertedWithCustomError(project, "NotAdmin");
        });

        it("Should reject name too long", async function () {
            const longName = "a".repeat(257);
            await expect(
                project.connect(admin1).setName(longName)
            ).to.be.revertedWithCustomError(project, "NameTooLong");
        });

        it("Should deposit to withdrawal pool without multi-sig", async function () {
            const amount = ethers.parseEther("1");

            await expect(
                project.connect(admin1).depositToWithdrawalPool(ethers.ZeroAddress, 0, { value: amount })
            ).to.emit(project, "AdminPoolOperation")
                .withArgs(projectId, ethers.ZeroAddress, admin1.address, amount, 0, 2); // AdminPoolOpType.POOL_DEPOSIT = 2, proposalId = 0

            const balance = await project.getBalance(ethers.ZeroAddress);
            expect(balance.withdrawalBalance).to.equal(amount);
        });
    });
});

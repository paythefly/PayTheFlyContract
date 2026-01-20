const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SafeERC20Universal", function () {
    let harness;
    let normalToken;
    let buggyToken;
    let owner;
    let recipient;
    let spender;

    const INITIAL_SUPPLY = ethers.parseEther("10000");

    beforeEach(async function () {
        [owner, recipient, spender] = await ethers.getSigners();

        // Deploy harness contract
        const Harness = await ethers.getContractFactory("SafeERC20UniversalHarness");
        harness = await Harness.deploy();
        await harness.waitForDeployment();

        // Deploy normal ERC20 token
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        normalToken = await MockERC20.deploy("Normal Token", "NORM", 18);
        await normalToken.waitForDeployment();

        // Deploy buggy USDT token (mimics TRON USDT)
        const MockBuggyUSDT = await ethers.getContractFactory("MockBuggyUSDT");
        buggyToken = await MockBuggyUSDT.deploy("Buggy USDT", "BUSDT", 6);
        await buggyToken.waitForDeployment();

        // Mint tokens to harness for transfer tests
        await normalToken.mint(await harness.getAddress(), INITIAL_SUPPLY);
        await buggyToken.mint(await harness.getAddress(), INITIAL_SUPPLY);

        // Mint tokens to owner for transferFrom tests
        await normalToken.mint(owner.address, INITIAL_SUPPLY);
        await buggyToken.mint(owner.address, INITIAL_SUPPLY);
    });

    describe("safeTransfer", function () {
        it("Should transfer normal tokens successfully", async function () {
            const amount = ethers.parseEther("100");
            const balanceBefore = await normalToken.balanceOf(recipient.address);

            await harness.testSafeTransfer(
                await normalToken.getAddress(),
                recipient.address,
                amount
            );

            const balanceAfter = await normalToken.balanceOf(recipient.address);
            expect(balanceAfter - balanceBefore).to.equal(amount);
        });

        it("Should transfer buggy tokens (returns false) successfully", async function () {
            const amount = ethers.parseUnits("100", 6);
            const balanceBefore = await buggyToken.balanceOf(recipient.address);

            await harness.testSafeTransfer(
                await buggyToken.getAddress(),
                recipient.address,
                amount
            );

            const balanceAfter = await buggyToken.balanceOf(recipient.address);
            expect(balanceAfter - balanceBefore).to.equal(amount);
        });

        it("Should handle zero amount transfer", async function () {
            await expect(
                harness.testSafeTransfer(
                    await normalToken.getAddress(),
                    recipient.address,
                    0
                )
            ).to.not.be.reverted;
        });

        it("Should handle self-transfer (to == address(this))", async function () {
            const amount = ethers.parseEther("100");
            await expect(
                harness.testSelfTransfer(await normalToken.getAddress(), amount)
            ).to.not.be.reverted;
        });

        it("Should revert on failed transfer (insufficient balance)", async function () {
            const amount = INITIAL_SUPPLY + 1n;
            await expect(
                harness.testSafeTransfer(
                    await normalToken.getAddress(),
                    recipient.address,
                    amount
                )
            ).to.be.revertedWithCustomError(harness, "SafeERC20UniversalFailedOperation");
        });
    });

    describe("safeTransferExact", function () {
        it("Should transfer exact amount with normal tokens", async function () {
            const amount = ethers.parseEther("100");
            const balanceBefore = await normalToken.balanceOf(recipient.address);

            await harness.testSafeTransferExact(
                await normalToken.getAddress(),
                recipient.address,
                amount
            );

            const balanceAfter = await normalToken.balanceOf(recipient.address);
            expect(balanceAfter - balanceBefore).to.equal(amount);
        });

        it("Should transfer exact amount with buggy tokens", async function () {
            const amount = ethers.parseUnits("100", 6);
            const balanceBefore = await buggyToken.balanceOf(recipient.address);

            await harness.testSafeTransferExact(
                await buggyToken.getAddress(),
                recipient.address,
                amount
            );

            const balanceAfter = await buggyToken.balanceOf(recipient.address);
            expect(balanceAfter - balanceBefore).to.equal(amount);
        });

        it("Should handle zero amount transfer", async function () {
            await expect(
                harness.testSafeTransferExact(
                    await normalToken.getAddress(),
                    recipient.address,
                    0
                )
            ).to.not.be.reverted;
        });

        it("Should handle self-transfer (to == address(this))", async function () {
            const amount = ethers.parseEther("100");
            await expect(
                harness.testSelfTransferExact(await normalToken.getAddress(), amount)
            ).to.not.be.reverted;
        });

        it("Should revert on fee-on-transfer token (received != amount)", async function () {
            // Deploy fee-on-transfer token
            const MockFeeToken = await ethers.getContractFactory("MockFeeOnTransferToken");
            const feeToken = await MockFeeToken.deploy("Fee Token", "FEE", 18);
            await feeToken.mint(await harness.getAddress(), INITIAL_SUPPLY);

            const amount = ethers.parseEther("100");

            await expect(
                harness.testSafeTransferExact(
                    await feeToken.getAddress(),
                    recipient.address,
                    amount
                )
            ).to.be.revertedWithCustomError(harness, "SafeERC20UniversalInsufficientReceived");
        });
    });

    describe("safeTransferFrom", function () {
        beforeEach(async function () {
            // Approve harness to spend owner's tokens
            await normalToken.approve(await harness.getAddress(), INITIAL_SUPPLY);
            await buggyToken.approve(await harness.getAddress(), INITIAL_SUPPLY);
        });

        it("Should transferFrom normal tokens successfully", async function () {
            const amount = ethers.parseEther("100");
            const balanceBefore = await normalToken.balanceOf(recipient.address);

            await harness.testSafeTransferFrom(
                await normalToken.getAddress(),
                owner.address,
                recipient.address,
                amount
            );

            const balanceAfter = await normalToken.balanceOf(recipient.address);
            expect(balanceAfter - balanceBefore).to.equal(amount);
        });

        it("Should transferFrom buggy tokens (returns false) successfully", async function () {
            const amount = ethers.parseUnits("100", 6);
            const balanceBefore = await buggyToken.balanceOf(recipient.address);

            await harness.testSafeTransferFrom(
                await buggyToken.getAddress(),
                owner.address,
                recipient.address,
                amount
            );

            const balanceAfter = await buggyToken.balanceOf(recipient.address);
            expect(balanceAfter - balanceBefore).to.equal(amount);
        });

        it("Should handle zero amount transferFrom", async function () {
            await expect(
                harness.testSafeTransferFrom(
                    await normalToken.getAddress(),
                    owner.address,
                    recipient.address,
                    0
                )
            ).to.not.be.reverted;
        });

        it("Should handle self-transferFrom (from == to)", async function () {
            const amount = ethers.parseEther("100");
            await expect(
                harness.testSelfTransferFrom(
                    await normalToken.getAddress(),
                    owner.address,
                    amount
                )
            ).to.not.be.reverted;
        });

        it("Should revert on failed transferFrom (insufficient allowance)", async function () {
            // Create new token without approval
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const newToken = await MockERC20.deploy("New Token", "NEW", 18);
            await newToken.mint(owner.address, INITIAL_SUPPLY);
            // No approval granted

            await expect(
                harness.testSafeTransferFrom(
                    await newToken.getAddress(),
                    owner.address,
                    recipient.address,
                    ethers.parseEther("100")
                )
            ).to.be.revertedWithCustomError(harness, "SafeERC20UniversalFailedOperation");
        });
    });

    describe("safeTransferFromExact", function () {
        beforeEach(async function () {
            await normalToken.approve(await harness.getAddress(), INITIAL_SUPPLY);
            await buggyToken.approve(await harness.getAddress(), INITIAL_SUPPLY);
        });

        it("Should transferFrom exact amount with normal tokens", async function () {
            const amount = ethers.parseEther("100");
            const balanceBefore = await normalToken.balanceOf(recipient.address);

            await harness.testSafeTransferFromExact(
                await normalToken.getAddress(),
                owner.address,
                recipient.address,
                amount
            );

            const balanceAfter = await normalToken.balanceOf(recipient.address);
            expect(balanceAfter - balanceBefore).to.equal(amount);
        });

        it("Should transferFrom exact amount with buggy tokens", async function () {
            const amount = ethers.parseUnits("100", 6);
            const balanceBefore = await buggyToken.balanceOf(recipient.address);

            await harness.testSafeTransferFromExact(
                await buggyToken.getAddress(),
                owner.address,
                recipient.address,
                amount
            );

            const balanceAfter = await buggyToken.balanceOf(recipient.address);
            expect(balanceAfter - balanceBefore).to.equal(amount);
        });

        it("Should handle zero amount transferFromExact", async function () {
            await expect(
                harness.testSafeTransferFromExact(
                    await normalToken.getAddress(),
                    owner.address,
                    recipient.address,
                    0
                )
            ).to.not.be.reverted;
        });

        it("Should handle self-transferFromExact (from == to)", async function () {
            const amount = ethers.parseEther("100");
            await expect(
                harness.testSelfTransferFromExact(
                    await normalToken.getAddress(),
                    owner.address,
                    amount
                )
            ).to.not.be.reverted;
        });

        it("Should revert on fee-on-transfer token (received != amount)", async function () {
            // Deploy fee-on-transfer token
            const MockFeeToken = await ethers.getContractFactory("MockFeeOnTransferToken");
            const feeToken = await MockFeeToken.deploy("Fee Token", "FEE", 18);
            await feeToken.mint(owner.address, INITIAL_SUPPLY);
            await feeToken.approve(await harness.getAddress(), INITIAL_SUPPLY);

            const amount = ethers.parseEther("100");

            await expect(
                harness.testSafeTransferFromExact(
                    await feeToken.getAddress(),
                    owner.address,
                    recipient.address,
                    amount
                )
            ).to.be.revertedWithCustomError(harness, "SafeERC20UniversalInsufficientReceived");
        });
    });

    describe("safeApprove", function () {
        it("Should approve normal tokens successfully", async function () {
            const amount = ethers.parseEther("1000");

            await harness.testSafeApprove(
                await normalToken.getAddress(),
                spender.address,
                amount
            );

            const allowance = await normalToken.allowance(
                await harness.getAddress(),
                spender.address
            );
            expect(allowance).to.equal(amount);
        });

        it("Should approve buggy tokens successfully", async function () {
            const amount = ethers.parseUnits("1000", 6);

            await harness.testSafeApprove(
                await buggyToken.getAddress(),
                spender.address,
                amount
            );

            const allowance = await buggyToken.allowance(
                await harness.getAddress(),
                spender.address
            );
            expect(allowance).to.equal(amount);
        });
    });

    describe("safeIncreaseAllowance", function () {
        it("Should increase allowance from zero", async function () {
            const amount = ethers.parseEther("100");

            await harness.testSafeIncreaseAllowance(
                await normalToken.getAddress(),
                spender.address,
                amount
            );

            const allowance = await normalToken.allowance(
                await harness.getAddress(),
                spender.address
            );
            expect(allowance).to.equal(amount);
        });

        it("Should increase existing allowance", async function () {
            const initialAmount = ethers.parseEther("100");
            const increaseAmount = ethers.parseEther("50");

            // Set initial allowance
            await harness.testSafeApprove(
                await normalToken.getAddress(),
                spender.address,
                initialAmount
            );

            // Increase allowance
            await harness.testSafeIncreaseAllowance(
                await normalToken.getAddress(),
                spender.address,
                increaseAmount
            );

            const allowance = await normalToken.allowance(
                await harness.getAddress(),
                spender.address
            );
            expect(allowance).to.equal(initialAmount + increaseAmount);
        });
    });

    describe("safeDecreaseAllowance", function () {
        beforeEach(async function () {
            // Set initial allowance
            await harness.testSafeApprove(
                await normalToken.getAddress(),
                spender.address,
                ethers.parseEther("1000")
            );
        });

        it("Should decrease allowance", async function () {
            const decreaseAmount = ethers.parseEther("300");

            await harness.testSafeDecreaseAllowance(
                await normalToken.getAddress(),
                spender.address,
                decreaseAmount
            );

            const allowance = await normalToken.allowance(
                await harness.getAddress(),
                spender.address
            );
            expect(allowance).to.equal(ethers.parseEther("700"));
        });

        it("Should revert when decreasing below zero", async function () {
            const decreaseAmount = ethers.parseEther("1001");

            await expect(
                harness.testSafeDecreaseAllowance(
                    await normalToken.getAddress(),
                    spender.address,
                    decreaseAmount
                )
            ).to.be.revertedWith("SafeERC20Universal: decreased allowance below zero");
        });
    });

    describe("forceApprove", function () {
        it("Should approve directly when no existing allowance", async function () {
            const amount = ethers.parseEther("100");

            await harness.testForceApprove(
                await normalToken.getAddress(),
                spender.address,
                amount
            );

            const allowance = await normalToken.allowance(
                await harness.getAddress(),
                spender.address
            );
            expect(allowance).to.equal(amount);
        });

        it("Should force approve with token that requires zero first", async function () {
            // Enable the requireZeroAllowanceFirst flag
            await buggyToken.setRequireZeroAllowanceFirst(true);
            await buggyToken.setReturnFalseOnApprove(false);

            // First approval
            const amount1 = ethers.parseUnits("100", 6);
            await harness.testForceApprove(
                await buggyToken.getAddress(),
                spender.address,
                amount1
            );

            let allowance = await buggyToken.allowance(
                await harness.getAddress(),
                spender.address
            );
            expect(allowance).to.equal(amount1);

            // Second approval with force (should reset to 0 first)
            const amount2 = ethers.parseUnits("200", 6);
            await harness.testForceApprove(
                await buggyToken.getAddress(),
                spender.address,
                amount2
            );

            allowance = await buggyToken.allowance(
                await harness.getAddress(),
                spender.address
            );
            expect(allowance).to.equal(amount2);
        });

        it("Should handle forceApprove when approve returns false", async function () {
            // Set up token to return false on approve
            await buggyToken.setReturnFalseOnApprove(true);
            await buggyToken.setRequireZeroAllowanceFirst(false);

            const amount = ethers.parseUnits("100", 6);
            await harness.testForceApprove(
                await buggyToken.getAddress(),
                spender.address,
                amount
            );

            const allowance = await buggyToken.allowance(
                await harness.getAddress(),
                spender.address
            );
            expect(allowance).to.equal(amount);
        });

        it("Should handle setting allowance to zero", async function () {
            // First set some allowance
            const amount = ethers.parseEther("100");
            await harness.testForceApprove(
                await normalToken.getAddress(),
                spender.address,
                amount
            );

            // Now set to zero
            await harness.testForceApprove(
                await normalToken.getAddress(),
                spender.address,
                0
            );

            const allowance = await normalToken.allowance(
                await harness.getAddress(),
                spender.address
            );
            expect(allowance).to.equal(0);
        });
    });

    describe("Edge Cases", function () {
        it("Should handle token that returns true correctly", async function () {
            // Disable the buggy behavior
            await buggyToken.setReturnFalseOnTransfer(false);

            const amount = ethers.parseUnits("100", 6);
            const balanceBefore = await buggyToken.balanceOf(recipient.address);

            await harness.testSafeTransfer(
                await buggyToken.getAddress(),
                recipient.address,
                amount
            );

            const balanceAfter = await buggyToken.balanceOf(recipient.address);
            expect(balanceAfter - balanceBefore).to.equal(amount);
        });

        it("Should emit TransferCompleted event on successful transfer", async function () {
            const amount = ethers.parseEther("100");

            await expect(
                harness.testSafeTransfer(
                    await normalToken.getAddress(),
                    recipient.address,
                    amount
                )
            )
                .to.emit(harness, "TransferCompleted")
                .withArgs(
                    await normalToken.getAddress(),
                    recipient.address,
                    amount
                );
        });

        it("Should emit TransferFromCompleted event on successful transferFrom", async function () {
            await normalToken.approve(await harness.getAddress(), INITIAL_SUPPLY);
            const amount = ethers.parseEther("100");

            await expect(
                harness.testSafeTransferFrom(
                    await normalToken.getAddress(),
                    owner.address,
                    recipient.address,
                    amount
                )
            )
                .to.emit(harness, "TransferFromCompleted")
                .withArgs(
                    await normalToken.getAddress(),
                    owner.address,
                    recipient.address,
                    amount
                );
        });
    });
});

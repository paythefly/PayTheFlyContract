const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Withdrawal Fee", function () {
    let factory;
    let project;
    let mockToken;
    let owner;
    let admin;
    let projectSigner;
    let feeVault;
    let user;

    const FEE_RATE = 100; // 1%
    const projectId = "withdrawal-fee-test";
    const projectName = "Withdrawal Fee Test";

    // EIP-712 types for withdrawal
    const WITHDRAWAL_TYPES = {
        WithdrawalRequest: [
            { name: "user", type: "address" },
            { name: "projectId", type: "string" },
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "serialNo", type: "string" },
            { name: "deadline", type: "uint256" }
        ]
    };

    async function getDomain(projectAddress) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        return {
            name: "PayTheFlyPro",
            version: "1",
            chainId: chainId,
            verifyingContract: projectAddress
        };
    }

    async function signWithdrawal(signer, projectAddress, withdrawal) {
        const domain = await getDomain(projectAddress);
        return signer.signTypedData(domain, WITHDRAWAL_TYPES, withdrawal);
    }

    beforeEach(async function () {
        [owner, admin, projectSigner, feeVault, user] = await ethers.getSigners();

        // Deploy Project implementation
        const Project = await ethers.getContractFactory("PayTheFlyPro");
        const projectImpl = await Project.deploy();
        await projectImpl.waitForDeployment();

        // Deploy PayTheFlyProFactory with UUPS proxy
        const PayTheFlyProFactory = await ethers.getContractFactory("PayTheFlyProFactory");
        factory = await upgrades.deployProxy(
            PayTheFlyProFactory,
            [await projectImpl.getAddress(), feeVault.address, FEE_RATE],
            { kind: "uups" }
        );
        await factory.waitForDeployment();

        // Create project
        const tx = await factory.createProject(
            projectId,
            projectName,
            admin.address,
            projectSigner.address
        );
        await tx.wait();

        const projectAddress = await factory.getProject(projectId);
        project = await ethers.getContractAt("PayTheFlyPro", projectAddress);

        // Deploy mock ERC20 (use fully qualified name to avoid artifact conflict)
        const MockERC20 = await ethers.getContractFactory("contracts/mock/MockERC20.sol:MockERC20");
        mockToken = await MockERC20.deploy("Test Token", "TEST", 18);
        await mockToken.waitForDeployment();

        // Admin deposits ETH to withdrawal pool
        const depositAmount = ethers.parseEther("10");
        await project.connect(admin).depositToWithdrawalPool(
            ethers.ZeroAddress,
            0,
            { value: depositAmount }
        );

        // Admin deposits ERC20 to withdrawal pool
        const tokenDepositAmount = ethers.parseEther("1000");
        await mockToken.mint(admin.address, tokenDepositAmount);
        await mockToken.connect(admin).approve(await project.getAddress(), tokenDepositAmount);
        await project.connect(admin).depositToWithdrawalPool(
            await mockToken.getAddress(),
            tokenDepositAmount
        );
    });

    describe("Factory: Withdrawal Fee Management", function () {
        it("Should have default withdrawal fee of 0", async function () {
            expect(await factory.withdrawalFee()).to.equal(0);
        });

        it("Should set withdrawal fee by owner", async function () {
            const newFee = ethers.parseEther("0.001"); // 0.001 ETH
            await factory.setWithdrawalFee(newFee);
            expect(await factory.withdrawalFee()).to.equal(newFee);
        });

        it("Should emit WithdrawalFeeUpdated event", async function () {
            const newFee = ethers.parseEther("0.001");
            await expect(factory.setWithdrawalFee(newFee))
                .to.emit(factory, "WithdrawalFeeUpdated")
                .withArgs(0, newFee);
        });

        it("Should update withdrawal fee multiple times", async function () {
            const fee1 = ethers.parseEther("0.001");
            const fee2 = ethers.parseEther("0.002");

            await factory.setWithdrawalFee(fee1);
            expect(await factory.withdrawalFee()).to.equal(fee1);

            await expect(factory.setWithdrawalFee(fee2))
                .to.emit(factory, "WithdrawalFeeUpdated")
                .withArgs(fee1, fee2);
            expect(await factory.withdrawalFee()).to.equal(fee2);
        });

        it("Should allow setting withdrawal fee to 0", async function () {
            const fee = ethers.parseEther("0.001");
            await factory.setWithdrawalFee(fee);

            await expect(factory.setWithdrawalFee(0))
                .to.emit(factory, "WithdrawalFeeUpdated")
                .withArgs(fee, 0);
            expect(await factory.withdrawalFee()).to.equal(0);
        });

        it("Should revert setWithdrawalFee from non-owner", async function () {
            const newFee = ethers.parseEther("0.001");
            await expect(
                factory.connect(user).setWithdrawalFee(newFee)
            ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
        });
    });

    describe("ETH Withdrawal with Fee", function () {
        const WITHDRAWAL_FEE = ethers.parseEther("0.001"); // 0.001 ETH

        beforeEach(async function () {
            // Set withdrawal fee
            await factory.setWithdrawalFee(WITHDRAWAL_FEE);
        });

        it("Should process withdrawal with correct fee", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "WD-FEE-001";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: user.address,
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const feeVaultBalanceBefore = await ethers.provider.getBalance(feeVault.address);

            const tx = await project.connect(user).withdraw(
                { user: user.address, token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                signature,
                { value: WITHDRAWAL_FEE }
            );
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const feeVaultBalanceAfter = await ethers.provider.getBalance(feeVault.address);

            // User receives withdrawal amount minus gas and fee
            expect(userBalanceAfter - userBalanceBefore + gasUsed + WITHDRAWAL_FEE).to.equal(amount);

            // Fee vault receives withdrawal fee
            expect(feeVaultBalanceAfter - feeVaultBalanceBefore).to.equal(WITHDRAWAL_FEE);
        });

        it("Should emit event with withdrawal fee", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "WD-FEE-002";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: user.address,
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            await expect(
                project.connect(user).withdraw(
                    { user: user.address, token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature,
                    { value: WITHDRAWAL_FEE }
                )
            ).to.emit(project, "PayTheFlyTransaction")
                .withArgs(
                    projectId,
                    ethers.ZeroAddress,
                    user.address,
                    amount,
                    WITHDRAWAL_FEE,
                    serialNo,
                    2 // TxType.WITHDRAWAL
                );
        });

        it("Should revert withdrawal with insufficient fee", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "WD-FEE-003";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: user.address,
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            const insufficientFee = WITHDRAWAL_FEE - 1n;

            await expect(
                project.connect(user).withdraw(
                    { user: user.address, token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature,
                    { value: insufficientFee }
                )
            ).to.be.revertedWithCustomError(project, "InsufficientWithdrawalFee");
        });

        it("Should revert withdrawal with zero fee when fee is required", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "WD-FEE-004";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: user.address,
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            await expect(
                project.connect(user).withdraw(
                    { user: user.address, token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature,
                    { value: 0 }
                )
            ).to.be.revertedWithCustomError(project, "InsufficientWithdrawalFee");
        });

        it("Should refund excess fee payment", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "WD-FEE-005";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: user.address,
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            const excessAmount = ethers.parseEther("0.01"); // 10x the fee
            const totalSent = WITHDRAWAL_FEE + excessAmount;

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const feeVaultBalanceBefore = await ethers.provider.getBalance(feeVault.address);

            const tx = await project.connect(user).withdraw(
                { user: user.address, token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                signature,
                { value: totalSent }
            );
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const feeVaultBalanceAfter = await ethers.provider.getBalance(feeVault.address);

            // Fee vault should only receive the exact fee (not the excess)
            expect(feeVaultBalanceAfter - feeVaultBalanceBefore).to.equal(WITHDRAWAL_FEE);

            // User should receive: withdrawal amount + refunded excess - gas - fee
            // userBalanceAfter = userBalanceBefore - totalSent + amount + excessRefund - gasUsed
            // userBalanceAfter = userBalanceBefore - (WITHDRAWAL_FEE + excess) + amount + excess - gasUsed
            // userBalanceAfter = userBalanceBefore - WITHDRAWAL_FEE + amount - gasUsed
            expect(userBalanceAfter - userBalanceBefore + gasUsed + WITHDRAWAL_FEE).to.equal(amount);
        });
    });

    describe("ERC20 Withdrawal with Fee", function () {
        const WITHDRAWAL_FEE = ethers.parseEther("0.001"); // 0.001 ETH

        beforeEach(async function () {
            await factory.setWithdrawalFee(WITHDRAWAL_FEE);
        });

        it("Should process ERC20 withdrawal with ETH fee", async function () {
            const amount = ethers.parseEther("100");
            const serialNo = "WD-ERC20-FEE-001";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: user.address,
                projectId: projectId,
                token: await mockToken.getAddress(),
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            const userTokenBalanceBefore = await mockToken.balanceOf(user.address);
            const feeVaultBalanceBefore = await ethers.provider.getBalance(feeVault.address);

            await project.connect(user).withdraw(
                { user: user.address, token: await mockToken.getAddress(), amount: amount, serialNo: serialNo, deadline: deadline },
                signature,
                { value: WITHDRAWAL_FEE }
            );

            const userTokenBalanceAfter = await mockToken.balanceOf(user.address);
            const feeVaultBalanceAfter = await ethers.provider.getBalance(feeVault.address);

            // User receives ERC20 tokens
            expect(userTokenBalanceAfter - userTokenBalanceBefore).to.equal(amount);

            // Fee vault receives ETH fee
            expect(feeVaultBalanceAfter - feeVaultBalanceBefore).to.equal(WITHDRAWAL_FEE);
        });

        it("Should revert ERC20 withdrawal with insufficient ETH fee", async function () {
            const amount = ethers.parseEther("100");
            const serialNo = "WD-ERC20-FEE-002";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: user.address,
                projectId: projectId,
                token: await mockToken.getAddress(),
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            await expect(
                project.connect(user).withdraw(
                    { user: user.address, token: await mockToken.getAddress(), amount: amount, serialNo: serialNo, deadline: deadline },
                    signature,
                    { value: 0 }
                )
            ).to.be.revertedWithCustomError(project, "InsufficientWithdrawalFee");
        });
    });

    describe("Withdrawal with Zero Fee", function () {
        it("Should process withdrawal without fee when withdrawalFee is 0", async function () {
            // Ensure withdrawal fee is 0
            expect(await factory.withdrawalFee()).to.equal(0);

            const amount = ethers.parseEther("1.0");
            const serialNo = "WD-ZERO-FEE-001";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: user.address,
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            const userBalanceBefore = await ethers.provider.getBalance(user.address);

            // Should succeed without sending any value
            const tx = await project.connect(user).withdraw(
                { user: user.address, token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                signature,
                { value: 0 }
            );
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const userBalanceAfter = await ethers.provider.getBalance(user.address);

            // User receives full withdrawal amount minus only gas
            expect(userBalanceAfter - userBalanceBefore + gasUsed).to.equal(amount);
        });

        it("Should emit event with zero fee when withdrawalFee is 0", async function () {
            expect(await factory.withdrawalFee()).to.equal(0);

            const amount = ethers.parseEther("1.0");
            const serialNo = "WD-ZERO-FEE-002";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: user.address,
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            await expect(
                project.connect(user).withdraw(
                    { user: user.address, token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature,
                    { value: 0 }
                )
            ).to.emit(project, "PayTheFlyTransaction")
                .withArgs(
                    projectId,
                    ethers.ZeroAddress,
                    user.address,
                    amount,
                    0, // Zero fee
                    serialNo,
                    2 // TxType.WITHDRAWAL
                );
        });
    });

    describe("Factory Upgrade Preserves Withdrawal Fee", function () {
        it("Should preserve withdrawal fee after factory upgrade", async function () {
            const fee = ethers.parseEther("0.005");
            await factory.setWithdrawalFee(fee);

            // Upgrade factory
            const PayTheFlyProFactoryV2 = await ethers.getContractFactory("PayTheFlyProFactory");
            const upgraded = await upgrades.upgradeProxy(factory, PayTheFlyProFactoryV2);

            // Verify state is preserved
            expect(await upgraded.withdrawalFee()).to.equal(fee);
            expect(await upgraded.feeVault()).to.equal(feeVault.address);
            expect(await upgraded.feeRate()).to.equal(FEE_RATE);
        });
    });
});

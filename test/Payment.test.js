const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Payment", function () {
    let factory;
    let project;
    let mockToken;
    let owner;
    let admin;
    let projectSigner;
    let feeVault;
    let payer;

    const FEE_RATE = 100; // 1%
    const projectId = "payment-test-project";
    const projectName = "Payment Test";

    // EIP-712 domain and types (consistent with EulerPay format)
    const PAYMENT_TYPES = {
        PaymentRequest: [
            { name: "projectId", type: "string" },
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "serialNo", type: "string" },
            { name: "deadline", type: "uint256" }
        ]
    };

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

    async function signPayment(signer, projectAddress, payment) {
        const domain = await getDomain(projectAddress);
        return signer.signTypedData(domain, PAYMENT_TYPES, payment);
    }

    async function signWithdrawal(signer, projectAddress, withdrawal) {
        const domain = await getDomain(projectAddress);
        return signer.signTypedData(domain, WITHDRAWAL_TYPES, withdrawal);
    }

    beforeEach(async function () {
        [owner, admin, projectSigner, feeVault, payer] = await ethers.getSigners();

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

        // Deploy mock ERC20
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockToken = await MockERC20.deploy("Test Token", "TEST", 18);
        await mockToken.waitForDeployment();

        // Mint tokens to payer
        await mockToken.mint(payer.address, ethers.parseEther("10000"));
    });

    describe("ETH Payment", function () {
        it("Should accept ETH payment with valid signature", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "PAY-001";
            const deadline = (await time.latest()) + 3600;

            const payment = {
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signPayment(projectSigner, await project.getAddress(), payment);

            const feeVaultBalanceBefore = await ethers.provider.getBalance(feeVault.address);

            await expect(
                project.connect(payer).pay(
                    { token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature,
                    { value: amount }
                )
            ).to.emit(project, "PayTheFlyTransaction"); // TxType.PAYMENT = 1

            // Check fee was transferred
            const feeVaultBalanceAfter = await ethers.provider.getBalance(feeVault.address);
            const expectedFee = amount * BigInt(FEE_RATE) / 10000n;
            expect(feeVaultBalanceAfter - feeVaultBalanceBefore).to.equal(expectedFee);

            // Check payment balance
            const balance = await project.getBalance(ethers.ZeroAddress);
            expect(balance.paymentBalance).to.equal(amount - expectedFee);
        });

        it("Should reject payment with invalid signature", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "PAY-002";
            const deadline = (await time.latest()) + 3600;

            // Sign with wrong signer
            const payment = {
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signPayment(admin, await project.getAddress(), payment);

            await expect(
                project.connect(payer).pay(
                    { token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature,
                    { value: amount }
                )
            ).to.be.revertedWithCustomError(project, "InvalidSignature");
        });

        it("Should reject payment with expired deadline", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "PAY-003";
            const deadline = (await time.latest()) - 3600; // Past deadline

            const payment = {
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signPayment(projectSigner, await project.getAddress(), payment);

            await expect(
                project.connect(payer).pay(
                    { token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature,
                    { value: amount }
                )
            ).to.be.revertedWithCustomError(project, "ExpiredDeadline");
        });

        it("Should reject replay attack (same serial number)", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "PAY-004";
            const deadline = (await time.latest()) + 3600;

            const payment = {
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signPayment(projectSigner, await project.getAddress(), payment);

            // First payment succeeds
            await project.connect(payer).pay(
                { token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                signature,
                { value: amount }
            );

            // Second payment with same serial number fails
            await expect(
                project.connect(payer).pay(
                    { token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature,
                    { value: amount }
                )
            ).to.be.revertedWithCustomError(project, "SerialNoUsed");
        });

        it("Should reject zero amount payment", async function () {
            const serialNo = "PAY-005";
            const deadline = (await time.latest()) + 3600;

            const payment = {
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: 0,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signPayment(projectSigner, await project.getAddress(), payment);

            await expect(
                project.connect(payer).pay(
                    { token: ethers.ZeroAddress, amount: 0, serialNo: serialNo, deadline: deadline },
                    signature,
                    { value: 0 }
                )
            ).to.be.revertedWithCustomError(project, "InvalidAmount");
        });

        it("Should reject empty serial number", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "";
            const deadline = (await time.latest()) + 3600;

            const payment = {
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signPayment(projectSigner, await project.getAddress(), payment);

            const Errors = await ethers.getContractFactory("contracts/libraries/Errors.sol:Errors");
            await expect(
                project.connect(payer).pay(
                    { token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature,
                    { value: amount }
                )
            ).to.be.revertedWithCustomError(Errors, "SerialNoEmpty");
        });
    });

    describe("ERC20 Payment", function () {
        it("Should accept ERC20 payment with valid signature", async function () {
            const amount = ethers.parseEther("100");
            const serialNo = "PAY-ERC20-001";
            const deadline = (await time.latest()) + 3600;

            // Approve tokens
            await mockToken.connect(payer).approve(await project.getAddress(), amount);

            const payment = {
                projectId: projectId,
                token: await mockToken.getAddress(),
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signPayment(projectSigner, await project.getAddress(), payment);

            const feeVaultBalanceBefore = await mockToken.balanceOf(feeVault.address);

            await expect(
                project.connect(payer).pay(
                    { token: await mockToken.getAddress(), amount: amount, serialNo: serialNo, deadline: deadline },
                    signature
                )
            ).to.emit(project, "PayTheFlyTransaction"); // TxType.PAYMENT = 1

            // Check fee was transferred
            const feeVaultBalanceAfter = await mockToken.balanceOf(feeVault.address);
            const expectedFee = amount * BigInt(FEE_RATE) / 10000n;
            expect(feeVaultBalanceAfter - feeVaultBalanceBefore).to.equal(expectedFee);

            // Check payment balance
            const balance = await project.getBalance(await mockToken.getAddress());
            expect(balance.paymentBalance).to.equal(amount - expectedFee);
        });

        it("Should reject ERC20 payment with wrong token in signature", async function () {
            const amount = ethers.parseEther("100");
            const serialNo = "PAY-ERC20-002";
            const deadline = (await time.latest()) + 3600;

            await mockToken.connect(payer).approve(await project.getAddress(), amount);

            // Sign with ETH address instead of token address
            const payment = {
                projectId: projectId,
                token: ethers.ZeroAddress, // Wrong token
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signPayment(projectSigner, await project.getAddress(), payment);

            await expect(
                project.connect(payer).pay(
                    { token: await mockToken.getAddress(), amount: amount, serialNo: serialNo, deadline: deadline },
                    signature
                )
            ).to.be.revertedWithCustomError(project, "InvalidSignature");
        });
    });

    describe("ETH Withdrawal", function () {
        beforeEach(async function () {
            // Admin deposits to withdrawal pool
            const depositAmount = ethers.parseEther("10");
            await project.connect(admin).depositToWithdrawalPool(
                ethers.ZeroAddress,
                0,
                { value: depositAmount }
            );
        });

        it("Should process ETH withdrawal with valid signature", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "WD-001";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: payer.address,
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            const payerBalanceBefore = await ethers.provider.getBalance(payer.address);

            const tx = await project.connect(payer).withdraw(
                { user: payer.address, token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                signature
            );
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const payerBalanceAfter = await ethers.provider.getBalance(payer.address);
            expect(payerBalanceAfter - payerBalanceBefore + gasUsed).to.equal(amount);

            // Check balance updated
            const balance = await project.getBalance(ethers.ZeroAddress);
            expect(balance.withdrawalBalance).to.equal(ethers.parseEther("9"));
        });

        it("Should reject withdrawal with insufficient balance", async function () {
            const amount = ethers.parseEther("100"); // More than deposited
            const serialNo = "WD-002";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: payer.address,
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            await expect(
                project.connect(payer).withdraw(
                    { user: payer.address, token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature
                )
            ).to.be.revertedWithCustomError(project, "InsufficientBalance");
        });

        it("Should reject withdrawal with wrong recipient", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "WD-003";
            const deadline = (await time.latest()) + 3600;

            // Signature is for admin, but payer tries to withdraw
            const withdrawal = {
                user: admin.address,
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            // Payer tries to use struct with admin as user (but msg.sender is payer) - InvalidAddress
            await expect(
                project.connect(payer).withdraw(
                    { user: admin.address, token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature
                )
            ).to.be.revertedWithCustomError(project, "InvalidAddress");
        });
    });

    describe("ERC20 Withdrawal", function () {
        beforeEach(async function () {
            // Admin deposits ERC20 to withdrawal pool
            const depositAmount = ethers.parseEther("1000");
            await mockToken.mint(admin.address, depositAmount);
            await mockToken.connect(admin).approve(await project.getAddress(), depositAmount);
            await project.connect(admin).depositToWithdrawalPool(
                await mockToken.getAddress(),
                depositAmount
            );
        });

        it("Should process ERC20 withdrawal with valid signature", async function () {
            const amount = ethers.parseEther("100");
            const serialNo = "WD-ERC20-001";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: payer.address,
                projectId: projectId,
                token: await mockToken.getAddress(),
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            const payerBalanceBefore = await mockToken.balanceOf(payer.address);

            await expect(
                project.connect(payer).withdraw(
                    { user: payer.address, token: await mockToken.getAddress(), amount: amount, serialNo: serialNo, deadline: deadline },
                    signature
                )
            ).to.emit(project, "PayTheFlyTransaction"); // TxType.WITHDRAWAL = 2

            const payerBalanceAfter = await mockToken.balanceOf(payer.address);
            expect(payerBalanceAfter - payerBalanceBefore).to.equal(amount);
        });
    });

    describe("Paused Project", function () {
        beforeEach(async function () {
            // Create and execute pause proposal
            const deadline = (await time.latest()) + 86400;
            const tx = await project.connect(admin).createProposal(
                6, // Pause
                "0x",
                deadline
            );
            const receipt = await tx.wait();

            // Get proposal ID from event
            const event = receipt.logs.find(log => {
                try {
                    return project.interface.parseLog(log)?.name === "ProposalCreated";
                } catch {
                    return false;
                }
            });
            const proposalId = project.interface.parseLog(event).args.proposalId;

            // Execute (threshold is 1)
            await project.connect(admin).executeProposal(proposalId);
        });

        it("Should reject payment when paused", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "PAY-PAUSED";
            const deadline = (await time.latest()) + 3600;

            const payment = {
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signPayment(projectSigner, await project.getAddress(), payment);

            await expect(
                project.connect(payer).pay(
                    { token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature,
                    { value: amount }
                )
            ).to.be.revertedWithCustomError(project, "ProjectPausedError");
        });

        it("Should reject withdrawal when paused", async function () {
            const amount = ethers.parseEther("1.0");
            const serialNo = "WD-PAUSED";
            const deadline = (await time.latest()) + 3600;

            const withdrawal = {
                user: payer.address,
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signWithdrawal(projectSigner, await project.getAddress(), withdrawal);

            await expect(
                project.connect(payer).withdraw(
                    { user: payer.address, token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                    signature
                )
            ).to.be.revertedWithCustomError(project, "ProjectPausedError");
        });
    });

    describe("Batch Balance Query", function () {
        it("Should return batch balances correctly", async function () {
            // Make a payment
            const amount = ethers.parseEther("1.0");
            const serialNo = "PAY-BATCH";
            const deadline = (await time.latest()) + 3600;

            const payment = {
                projectId: projectId,
                token: ethers.ZeroAddress,
                amount: amount,
                serialNo: serialNo,
                deadline: deadline
            };

            const signature = await signPayment(projectSigner, await project.getAddress(), payment);
            await project.connect(payer).pay(
                { token: ethers.ZeroAddress, amount: amount, serialNo: serialNo, deadline: deadline },
                signature,
                { value: amount }
            );

            // Query batch balances
            const balances = await project.getBalancesBatch([
                ethers.ZeroAddress,
                await mockToken.getAddress()
            ]);

            expect(balances.length).to.equal(2);
            expect(balances[0].paymentBalance).to.be.gt(0);
            expect(balances[1].paymentBalance).to.equal(0);
        });
    });
});

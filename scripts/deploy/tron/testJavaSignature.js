/**
 * Test and Verify Java-style EIP-712 Signature for PayTheFlyPro
 * This script simulates the Java signing process and verifies it
 *
 * Usage:
 *   npx hardhat run scripts/deploy/tron/testJavaSignature.js
 */

const { ethers } = require("hardhat");
const { TronWeb } = require("tronweb");

// ============ Constants ============

const DOMAIN_NAME = "PayTheFlyPro";
const DOMAIN_VERSION = "1";

// TypeHash (must match contract)
const PAYMENT_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes("PaymentRequest(string projectId,address token,uint256 amount,string serialNo,uint256 deadline)")
);

const DOMAIN_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
);

// ============ Address Conversion ============

function tronToEvmAddress(tronBase58) {
    const tronWeb = new TronWeb({ fullHost: "https://nile.trongrid.io" });
    const hexAddress = tronWeb.address.toHex(tronBase58);
    // Remove 41 prefix and add 0x
    return "0x" + hexAddress.slice(2).toLowerCase();
}

function evmToTronAddress(evmHex) {
    const tronWeb = new TronWeb({ fullHost: "https://nile.trongrid.io" });
    const hexWithPrefix = "41" + evmHex.slice(2);
    return tronWeb.address.fromHex(hexWithPrefix);
}

// ============ Manual EIP-712 Implementation (Java-style) ============

function calculateDomainSeparator(chainId, verifyingContractHex) {
    // abi.encode(DOMAIN_TYPEHASH, keccak256(name), keccak256(version), chainId, contract)
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "bytes32", "uint256", "address"],
        [
            DOMAIN_TYPEHASH,
            ethers.keccak256(ethers.toUtf8Bytes(DOMAIN_NAME)),
            ethers.keccak256(ethers.toUtf8Bytes(DOMAIN_VERSION)),
            chainId,
            verifyingContractHex
        ]
    );
    return ethers.keccak256(encoded);
}

function calculatePaymentStructHash(projectId, tokenHex, amountWei, serialNo, deadline) {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "address", "uint256", "bytes32", "uint256"],
        [
            PAYMENT_TYPEHASH,
            ethers.keccak256(ethers.toUtf8Bytes(projectId)),
            tokenHex,
            amountWei,
            ethers.keccak256(ethers.toUtf8Bytes(serialNo)),
            deadline
        ]
    );
    return ethers.keccak256(encoded);
}

function calculateTypedDataHash(domainSeparator, structHash) {
    // keccak256("\x19\x01" + domainSeparator + structHash)
    return ethers.keccak256(
        ethers.concat([
            "0x1901",
            domainSeparator,
            structHash
        ])
    );
}

// ============ Main Test ============

async function main() {
    console.log("========================================");
    console.log("Java-style EIP-712 Signature Test");
    console.log("========================================\n");

    // Test parameters
    const privateKey = "599ae61bfe5620ae9afe4fcba178a2df1abaa99c718a685bf58f40912d039b38";
    const wallet = new ethers.Wallet(privateKey);

    const params = {
        chainId: 3448148188n,  // TRON Nile
        verifyingContract: "TUtW6MEPndq82r7cQUk8QLPd6qZuejtxBe",
        projectId: "cbe00bfa-3ce4-4013-b04d-d4fc97339197",
        token: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
        amount: "0.0021",
        decimals: 6,
        serialNo: "ORDER-TEST-001",
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600)
    };

    // Convert addresses
    const verifyingContractHex = tronToEvmAddress(params.verifyingContract);
    const tokenHex = tronToEvmAddress(params.token);
    const amountWei = ethers.parseUnits(params.amount, params.decimals);

    console.log("Signer:");
    console.log("  EVM Address:", wallet.address);
    console.log("  TRON Address:", evmToTronAddress(wallet.address));
    console.log("");

    console.log("Parameters:");
    console.log("  chainId:", params.chainId.toString());
    console.log("  verifyingContract:", params.verifyingContract);
    console.log("  verifyingContract (hex):", verifyingContractHex);
    console.log("  projectId:", params.projectId);
    console.log("  token:", params.token);
    console.log("  token (hex):", tokenHex);
    console.log("  amount:", params.amount, `(${params.decimals} decimals)`);
    console.log("  amount (wei):", amountWei.toString());
    console.log("  serialNo:", params.serialNo);
    console.log("  deadline:", params.deadline.toString());
    console.log("");

    // ========== Method 1: Manual (Java-style) ==========
    console.log("========================================");
    console.log("Method 1: Manual (Java-style)");
    console.log("========================================");

    const domainSeparator = calculateDomainSeparator(params.chainId, verifyingContractHex);
    console.log("Domain Separator:", domainSeparator);

    const structHash = calculatePaymentStructHash(
        params.projectId,
        tokenHex,
        amountWei,
        params.serialNo,
        params.deadline
    );
    console.log("Struct Hash:", structHash);

    const finalHash = calculateTypedDataHash(domainSeparator, structHash);
    console.log("Final Hash:", finalHash);

    // Sign the hash directly (like Java does)
    const signingKey = new ethers.SigningKey("0x" + privateKey);
    const manualSignature = signingKey.sign(finalHash);
    const manualSigHex = ethers.Signature.from(manualSignature).serialized;
    console.log("Manual Signature:", manualSigHex);
    console.log("");

    // ========== Method 2: ethers.js signTypedData ==========
    console.log("========================================");
    console.log("Method 2: ethers.js signTypedData");
    console.log("========================================");

    const domain = {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: params.chainId,
        verifyingContract: verifyingContractHex
    };

    const types = {
        PaymentRequest: [
            { name: "projectId", type: "string" },
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "serialNo", type: "string" },
            { name: "deadline", type: "uint256" }
        ]
    };

    const message = {
        projectId: params.projectId,
        token: tokenHex,
        amount: amountWei,
        serialNo: params.serialNo,
        deadline: params.deadline
    };

    // Verify domain separator matches
    const ethersHashDomain = ethers.TypedDataEncoder.hashDomain(domain);
    console.log("ethers Domain Separator:", ethersHashDomain);
    console.log("Domain Separator Match:", ethersHashDomain === domainSeparator ? "✓" : "✗");

    // Verify struct hash matches
    const ethersHashStruct = ethers.TypedDataEncoder.hashStruct("PaymentRequest", types, message);
    console.log("ethers Struct Hash:", ethersHashStruct);
    console.log("Struct Hash Match:", ethersHashStruct === structHash ? "✓" : "✗");

    // Sign with signTypedData
    const ethersSignature = await wallet.signTypedData(domain, types, message);
    console.log("ethers Signature:", ethersSignature);
    console.log("");

    // ========== Verify Both Signatures ==========
    console.log("========================================");
    console.log("Signature Verification");
    console.log("========================================");

    // Verify manual signature
    const recoveredFromManual = ethers.recoverAddress(finalHash, manualSigHex);
    console.log("Recovered from Manual:", recoveredFromManual);
    console.log("Manual Signature Valid:", recoveredFromManual.toLowerCase() === wallet.address.toLowerCase() ? "✓" : "✗");

    // Verify ethers signature
    const recoveredFromEthers = ethers.verifyTypedData(domain, types, message, ethersSignature);
    console.log("Recovered from ethers:", recoveredFromEthers);
    console.log("ethers Signature Valid:", recoveredFromEthers.toLowerCase() === wallet.address.toLowerCase() ? "✓" : "✗");

    // Compare signatures
    console.log("");
    console.log("Signatures Match:", manualSigHex === ethersSignature ? "✓" : "✗");

    // ========== Output for On-chain Test ==========
    console.log("");
    console.log("========================================");
    console.log("For On-chain Test (contract call):");
    console.log("========================================");
    console.log(`
// Solidity PaymentRequest struct
PaymentRequest memory request = PaymentRequest({
    token: ${tokenHex},
    amount: ${amountWei},
    serialNo: "${params.serialNo}",
    deadline: ${params.deadline}
});

// Signature
bytes memory signature = hex"${manualSigHex.slice(2)}";

// Call pay() function on project contract: ${params.verifyingContract}
    `);

    // ========== Java Code Output ==========
    console.log("========================================");
    console.log("Java Test Values:");
    console.log("========================================");
    console.log(`
// Expected values from Java TronPaymentSigner:
private_key = "${privateKey}"
signer_evm = "${wallet.address}"
signer_tron = "${evmToTronAddress(wallet.address)}"

chainId = ${params.chainId}L
verifyingContract = "${params.verifyingContract}"
projectId = "${params.projectId}"
token = "${params.token}"
amount = new BigDecimal("${params.amount}")
decimals = ${params.decimals}
serialNo = "${params.serialNo}"
deadline = ${params.deadline}L

// Expected signature (first 10 chars): ${manualSigHex.slice(0, 12)}...
// Full signature: ${manualSigHex}
    `);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

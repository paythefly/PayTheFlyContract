/**
 * Generate Payment Link for PayTheFlyPro
 *
 * Usage:
 *   npx hardhat run scripts/deploy/tron/generatePaymentLink.js
 */

const { ethers } = require("hardhat");
const { TronWeb } = require("tronweb");

// ============ Constants ============

const DOMAIN_NAME = "PayTheFlyPro";
const DOMAIN_VERSION = "1";

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
    return "0x" + hexAddress.slice(2).toLowerCase();
}

function evmToTronAddress(evmHex) {
    const tronWeb = new TronWeb({ fullHost: "https://nile.trongrid.io" });
    const hexWithPrefix = "41" + evmHex.slice(2).toLowerCase();
    return tronWeb.address.fromHex(hexWithPrefix);
}

// ============ EIP-712 Signing ============

function calculateDomainSeparator(chainId, verifyingContractHex) {
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

function signPayment(privateKey, chainId, verifyingContractHex, projectId, tokenHex, amountWei, serialNo, deadline) {
    const domainSeparator = calculateDomainSeparator(chainId, verifyingContractHex);
    const structHash = calculatePaymentStructHash(projectId, tokenHex, amountWei, serialNo, deadline);

    // Final hash: keccak256("\x19\x01" + domainSeparator + structHash)
    const finalHash = ethers.keccak256(
        ethers.concat(["0x1901", domainSeparator, structHash])
    );

    // Sign
    const signingKey = new ethers.SigningKey(privateKey);
    const signature = signingKey.sign(finalHash);
    return ethers.Signature.from(signature).serialized;
}

// ============ Main ============

async function main() {
    console.log("========================================");
    console.log("Generate Payment Link for PayTheFlyPro");
    console.log("========================================\n");

    // ========== 用户提供的参数 ==========
    const signerPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const signerTronAddress = "TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG";
    const projectId = "346e246e-30a6-441b-958e-cd7d93829a3f";

    // ========== 需要确认的参数 ==========
    // 项目合约地址 (verifyingContract) - 需要用户提供
    // 这里假设使用 Nile 测试网上的某个项目合约
    // 如果没有项目合约，需要先通过 Factory 创建项目
    const projectContractAddress = process.env.PROJECT || "TTXfCAzZLLCn6YCye8CEwJDZw8bzU5rg4D"; // 示例地址

    // Token 地址 (Nile USDT 或其他代币)
    const tokenAddress = process.env.TOKEN || "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"; // Nile USDT

    // 支付金额和精度
    const amount = process.env.AMOUNT || "1.5";
    const decimals = parseInt(process.env.DECIMALS || "6");

    // ChainId
    const chainId = BigInt(process.env.CHAIN_ID || "3448148188"); // TRON Nile

    // ========== 自动生成的参数 ==========
    const serialNo = "ORDER-" + Date.now();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1小时后过期

    // 验证签名者地址
    const wallet = new ethers.Wallet(signerPrivateKey);
    const derivedTronAddress = evmToTronAddress(wallet.address);

    console.log("签名者信息:");
    console.log("  私钥: " + signerPrivateKey.slice(0, 10) + "...");
    console.log("  EVM地址: " + wallet.address);
    console.log("  TRON地址 (派生): " + derivedTronAddress);
    console.log("  TRON地址 (提供): " + signerTronAddress);
    console.log("  地址匹配: " + (derivedTronAddress === signerTronAddress ? "✓" : "✗ 警告!"));
    console.log("");

    // 转换地址
    const projectContractHex = tronToEvmAddress(projectContractAddress);
    const tokenHex = tronToEvmAddress(tokenAddress);
    const amountWei = ethers.parseUnits(amount, decimals);

    console.log("支付参数:");
    console.log("  ChainId: " + chainId);
    console.log("  项目合约: " + projectContractAddress);
    console.log("  项目合约 (hex): " + projectContractHex);
    console.log("  项目ID: " + projectId);
    console.log("  Token: " + tokenAddress);
    console.log("  Token (hex): " + tokenHex);
    console.log("  金额: " + amount + " (" + decimals + " decimals)");
    console.log("  金额 (wei): " + amountWei.toString());
    console.log("  订单号: " + serialNo);
    console.log("  截止时间: " + deadline + " (" + new Date(Number(deadline) * 1000).toISOString() + ")");
    console.log("");

    // 生成签名
    const signature = signPayment(
        signerPrivateKey,
        chainId,
        projectContractHex,
        projectId,
        tokenHex,
        amountWei,
        serialNo,
        deadline
    );

    console.log("生成的签名: " + signature);
    console.log("");

    // 验证签名
    const domainSeparator = calculateDomainSeparator(chainId, projectContractHex);
    const structHash = calculatePaymentStructHash(projectId, tokenHex, amountWei, serialNo, deadline);
    const finalHash = ethers.keccak256(ethers.concat(["0x1901", domainSeparator, structHash]));
    const recoveredAddress = ethers.recoverAddress(finalHash, signature);

    console.log("签名验证:");
    console.log("  恢复的地址: " + recoveredAddress);
    console.log("  签名有效: " + (recoveredAddress.toLowerCase() === wallet.address.toLowerCase() ? "✓" : "✗"));
    console.log("");

    // 构建支付链接参数 (按指定顺序)
    const paymentParams = {
        projectId: projectId,
        token: tokenAddress,
        amount: amountWei.toString(),
        serialNo: serialNo,
        deadline: deadline.toString(),
        signature: signature,
        chainId: chainId.toString()
    };

    // URL编码 (保持参数顺序)
    const paramOrder = ['projectId', 'token', 'amount', 'serialNo', 'deadline', 'signature', 'chainId'];
    const queryString = paramOrder
        .map(key => `${key}=${encodeURIComponent(paymentParams[key])}`)
        .join('&');

    const baseUrl = "https://pro.paythefly.com/pay";
    const paymentLink = `${baseUrl}?${queryString}`;

    console.log("========================================");
    console.log("支付链接参数 (JSON):");
    console.log("========================================");
    console.log(JSON.stringify(paymentParams, null, 2));
    console.log("");

    console.log("========================================");
    console.log("支付链接:");
    console.log("========================================");
    console.log(paymentLink);
    console.log("");

    // 输出合约调用参数
    console.log("========================================");
    console.log("合约调用参数 (Solidity):");
    console.log("========================================");
    console.log(`
// PaymentRequest struct
IPayTheFlyPro.PaymentRequest memory request = IPayTheFlyPro.PaymentRequest({
    token: address(${tokenHex}),
    amount: ${amountWei},
    serialNo: "${serialNo}",
    deadline: ${deadline}
});

// Signature
bytes memory signature = hex"${signature.slice(2)}";

// Call: project.pay(request, signature)
// Project contract: ${projectContractAddress}
    `);

    // 输出 Java 代码调用示例
    console.log("========================================");
    console.log("Java 代码调用示例:");
    console.log("========================================");
    console.log(`
TronPaymentSigner signer = new TronPaymentSigner(
    "${signerPrivateKey.slice(2)}"  // 不含0x前缀
);

String signature = signer.signPayment(
    ${chainId}L,                                    // chainId
    "${projectContractAddress}",   // verifyingContract (项目合约)
    "${projectId}",                // projectId
    "${tokenAddress}",             // token
    new BigDecimal("${amount}"),                    // amount
    ${decimals},                                    // decimals
    "${serialNo}",                                  // serialNo
    ${deadline}L                                    // deadline
);

// 预期签名: ${signature}
    `);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

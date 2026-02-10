package com.paytheflyPro.signer;

import org.web3j.crypto.*;
import org.web3j.utils.Numeric;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Arrays;

/**
 * EIP-712 Payment Signer for PayTheFlyPro on TRON
 *
 * Dependencies (Maven):
 * <dependency>
 *     <groupId>org.web3j</groupId>
 *     <artifactId>core</artifactId>
 *     <version>4.9.8</version>
 * </dependency>
 */
public class TronPaymentSigner {

    // EIP-712 Domain
    private static final String DOMAIN_NAME = "PayTheFlyPro";
    private static final String DOMAIN_VERSION = "1";

    // TypeHash for PaymentRequest
    // keccak256("PaymentRequest(string projectId,address token,uint256 amount,string serialNo,uint256 deadline)")
    private static final byte[] PAYMENT_TYPEHASH = keccak256(
            "PaymentRequest(string projectId,address token,uint256 amount,string serialNo,uint256 deadline)".getBytes(StandardCharsets.UTF_8)
    );

    // EIP-712 Domain TypeHash
    // keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    private static final byte[] DOMAIN_TYPEHASH = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)".getBytes(StandardCharsets.UTF_8)
    );

    private final ECKeyPair keyPair;
    private final String signerAddress;

    /**
     * Constructor with private key bytes
     */
    public TronPaymentSigner(byte[] privateKey) {
        this.keyPair = ECKeyPair.create(privateKey);
        // Get EVM address (without 0x prefix)
        String evmAddress = Keys.getAddress(keyPair);
        this.signerAddress = "0x" + evmAddress;
    }

    /**
     * Constructor with hex private key string
     */
    public TronPaymentSigner(String privateKeyHex) {
        this(Numeric.hexStringToByteArray(privateKeyHex));
    }

    /**
     * Get signer's EVM address (0x format)
     */
    public String getSignerEvmAddress() {
        return signerAddress;
    }

    /**
     * Get signer's TRON address (Base58 format)
     */
    public String getSignerTronAddress() {
        return evmToTronAddress(signerAddress);
    }

    /**
     * Generate payment signature
     *
     * @param chainId            Chain ID (TRON Nile: 3448148188, TRON Mainnet: 728126428)
     * @param verifyingContract  Project contract address (TRON Base58 format)
     * @param projectId          Project UUID
     * @param tokenAddress       Token address (TRON Base58 format, or "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb" style)
     * @param amount             Amount in token units (e.g., 1.5 USDT)
     * @param decimals           Token decimals (e.g., 6 for USDT)
     * @param serialNo           Unique serial number
     * @param deadline           Unix timestamp deadline
     * @return Signature in hex format (with 0x prefix)
     */
    public String signPayment(
            long chainId,
            String verifyingContract,
            String projectId,
            String tokenAddress,
            BigDecimal amount,
            int decimals,
            String serialNo,
            long deadline
    ) {
        // Convert addresses to EVM hex format
        String contractHex = tronToEvmAddress(verifyingContract);
        String tokenHex = tronToEvmAddress(tokenAddress);

        // Convert amount to wei (multiply by 10^decimals)
        BigInteger amountWei = amount.multiply(BigDecimal.TEN.pow(decimals)).toBigInteger();

        // Calculate domain separator
        byte[] domainSeparator = calculateDomainSeparator(chainId, contractHex);

        // Calculate struct hash
        byte[] structHash = calculatePaymentStructHash(projectId, tokenHex, amountWei, serialNo, deadline);

        // Calculate final hash: keccak256("\x19\x01" + domainSeparator + structHash)
        byte[] finalHash = calculateTypedDataHash(domainSeparator, structHash);

        // Sign the hash
        Sign.SignatureData signatureData = Sign.signMessage(finalHash, keyPair, false);

        // Combine r + s + v into signature bytes
        byte[] signature = new byte[65];
        System.arraycopy(signatureData.getR(), 0, signature, 0, 32);
        System.arraycopy(signatureData.getS(), 0, signature, 32, 32);
        signature[64] = signatureData.getV()[0];

        return Numeric.toHexString(signature);
    }

    /**
     * Calculate EIP-712 domain separator
     */
    private byte[] calculateDomainSeparator(long chainId, String verifyingContractHex) {
        // domainSeparator = keccak256(abi.encode(
        //     DOMAIN_TYPEHASH,
        //     keccak256(bytes(name)),
        //     keccak256(bytes(version)),
        //     chainId,
        //     verifyingContract
        // ))

        byte[] nameHash = keccak256(DOMAIN_NAME.getBytes(StandardCharsets.UTF_8));
        byte[] versionHash = keccak256(DOMAIN_VERSION.getBytes(StandardCharsets.UTF_8));
        byte[] chainIdBytes = padLeft32(BigInteger.valueOf(chainId).toByteArray());
        byte[] contractBytes = padLeft32(Numeric.hexStringToByteArray(verifyingContractHex));

        byte[] encoded = concatenate(
                DOMAIN_TYPEHASH,
                nameHash,
                versionHash,
                chainIdBytes,
                contractBytes
        );

        return keccak256(encoded);
    }

    /**
     * Calculate payment struct hash
     */
    private byte[] calculatePaymentStructHash(
            String projectId,
            String tokenHex,
            BigInteger amountWei,
            String serialNo,
            long deadline
    ) {
        // structHash = keccak256(abi.encode(
        //     PAYMENT_TYPEHASH,
        //     keccak256(bytes(projectId)),
        //     token,
        //     amount,
        //     keccak256(bytes(serialNo)),
        //     deadline
        // ))

        byte[] projectIdHash = keccak256(projectId.getBytes(StandardCharsets.UTF_8));
        byte[] tokenBytes = padLeft32(Numeric.hexStringToByteArray(tokenHex));
        byte[] amountBytes = padLeft32(amountWei.toByteArray());
        byte[] serialNoHash = keccak256(serialNo.getBytes(StandardCharsets.UTF_8));
        byte[] deadlineBytes = padLeft32(BigInteger.valueOf(deadline).toByteArray());

        byte[] encoded = concatenate(
                PAYMENT_TYPEHASH,
                projectIdHash,
                tokenBytes,
                amountBytes,
                serialNoHash,
                deadlineBytes
        );

        return keccak256(encoded);
    }

    /**
     * Calculate final typed data hash
     */
    private byte[] calculateTypedDataHash(byte[] domainSeparator, byte[] structHash) {
        // keccak256("\x19\x01" + domainSeparator + structHash)
        byte[] prefix = new byte[]{0x19, 0x01};
        byte[] data = concatenate(prefix, domainSeparator, structHash);
        return keccak256(data);
    }

    // ============ Utility Methods ============

    /**
     * Convert TRON Base58 address to EVM hex address (0x format)
     * Example: TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf -> 0xeca9bc828a3005b9a3b909f2cc5c2a54794de05f
     */
    public static String tronToEvmAddress(String tronBase58) {
        byte[] decoded = Base58.decode(tronBase58);
        // TRON address: 41 (1 byte) + address (20 bytes) + checksum (4 bytes) = 25 bytes
        if (decoded.length != 25) {
            throw new IllegalArgumentException("Invalid TRON address length: " + decoded.length);
        }
        // Skip first byte (0x41) and last 4 bytes (checksum)
        byte[] addressBytes = Arrays.copyOfRange(decoded, 1, 21);
        return "0x" + Numeric.toHexStringNoPrefix(addressBytes);
    }

    /**
     * Convert EVM hex address to TRON Base58 address
     * Example: 0xeca9bc828a3005b9a3b909f2cc5c2a54794de05f -> TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf
     */
    public static String evmToTronAddress(String evmHex) {
        byte[] addressBytes = Numeric.hexStringToByteArray(evmHex);
        if (addressBytes.length != 20) {
            throw new IllegalArgumentException("Invalid EVM address length: " + addressBytes.length);
        }

        // Add TRON prefix (0x41)
        byte[] tronAddress = new byte[21];
        tronAddress[0] = 0x41;
        System.arraycopy(addressBytes, 0, tronAddress, 1, 20);

        // Calculate checksum (first 4 bytes of double SHA256)
        byte[] hash1 = sha256(tronAddress);
        byte[] hash2 = sha256(hash1);
        byte[] checksum = Arrays.copyOfRange(hash2, 0, 4);

        // Combine address + checksum
        byte[] addressWithChecksum = new byte[25];
        System.arraycopy(tronAddress, 0, addressWithChecksum, 0, 21);
        System.arraycopy(checksum, 0, addressWithChecksum, 21, 4);

        return Base58.encode(addressWithChecksum);
    }

    /**
     * Keccak256 hash
     */
    private static byte[] keccak256(byte[] input) {
        return Hash.sha3(input);
    }

    /**
     * SHA256 hash
     */
    private static byte[] sha256(byte[] input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return digest.digest(input);
        } catch (Exception e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    /**
     * Pad byte array to 32 bytes (left padding with zeros)
     */
    private static byte[] padLeft32(byte[] input) {
        if (input.length >= 32) {
            return Arrays.copyOfRange(input, input.length - 32, input.length);
        }
        byte[] result = new byte[32];
        System.arraycopy(input, 0, result, 32 - input.length, input.length);
        return result;
    }

    /**
     * Concatenate byte arrays
     */
    private static byte[] concatenate(byte[]... arrays) {
        int totalLength = 0;
        for (byte[] array : arrays) {
            totalLength += array.length;
        }
        byte[] result = new byte[totalLength];
        int offset = 0;
        for (byte[] array : arrays) {
            System.arraycopy(array, 0, result, offset, array.length);
            offset += array.length;
        }
        return result;
    }

    // ============ Base58 Implementation ============

    /**
     * Simple Base58 encoder/decoder for TRON addresses
     */
    public static class Base58 {
        private static final String ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        private static final int[] INDEXES = new int[128];

        static {
            Arrays.fill(INDEXES, -1);
            for (int i = 0; i < ALPHABET.length(); i++) {
                INDEXES[ALPHABET.charAt(i)] = i;
            }
        }

        public static String encode(byte[] input) {
            if (input.length == 0) return "";

            // Count leading zeros
            int zeros = 0;
            while (zeros < input.length && input[zeros] == 0) {
                zeros++;
            }

            // Convert to base58
            byte[] temp = Arrays.copyOf(input, input.length);
            char[] encoded = new char[temp.length * 2];
            int outputStart = encoded.length;

            for (int inputStart = zeros; inputStart < temp.length; ) {
                encoded[--outputStart] = ALPHABET.charAt(divmod(temp, inputStart, 256, 58));
                if (temp[inputStart] == 0) {
                    inputStart++;
                }
            }

            // Add leading '1's for each leading zero byte
            while (outputStart < encoded.length && encoded[outputStart] == ALPHABET.charAt(0)) {
                outputStart++;
            }
            while (--zeros >= 0) {
                encoded[--outputStart] = ALPHABET.charAt(0);
            }

            return new String(encoded, outputStart, encoded.length - outputStart);
        }

        public static byte[] decode(String input) {
            if (input.length() == 0) return new byte[0];

            byte[] input58 = new byte[input.length()];
            for (int i = 0; i < input.length(); i++) {
                char c = input.charAt(i);
                int digit = c < 128 ? INDEXES[c] : -1;
                if (digit < 0) {
                    throw new IllegalArgumentException("Invalid Base58 character: " + c);
                }
                input58[i] = (byte) digit;
            }

            // Count leading zeros
            int zeros = 0;
            while (zeros < input58.length && input58[zeros] == 0) {
                zeros++;
            }

            // Convert from base58
            byte[] decoded = new byte[input.length()];
            int outputStart = decoded.length;

            for (int inputStart = zeros; inputStart < input58.length; ) {
                decoded[--outputStart] = divmod(input58, inputStart, 58, 256);
                if (input58[inputStart] == 0) {
                    inputStart++;
                }
            }

            while (outputStart < decoded.length && decoded[outputStart] == 0) {
                outputStart++;
            }

            return Arrays.copyOfRange(decoded, outputStart - zeros, decoded.length);
        }

        private static byte divmod(byte[] number, int firstDigit, int base, int divisor) {
            int remainder = 0;
            for (int i = firstDigit; i < number.length; i++) {
                int digit = (int) number[i] & 0xFF;
                int temp = remainder * base + digit;
                number[i] = (byte) (temp / divisor);
                remainder = temp % divisor;
            }
            return (byte) remainder;
        }
    }

    // ============ Main Method for Testing ============

    public static void main(String[] args) {
        try {
            // Test private key
            String privateKey = "599ae61bfe5620ae9afe4fcba178a2df1abaa99c718a685bf58f40912d039b38";

            TronPaymentSigner signer = new TronPaymentSigner(privateKey);

            System.out.println("========================================");
            System.out.println("TronPaymentSigner Test");
            System.out.println("========================================");
            System.out.println("Signer EVM Address: " + signer.getSignerEvmAddress());
            System.out.println("Signer TRON Address: " + signer.getSignerTronAddress());
            System.out.println();

            // Test parameters (matching the JS verification script)
            long chainId = 3448148188L;  // TRON Nile
            String verifyingContract = "TUtW6MEPndq82r7cQUk8QLPd6qZuejtxBe";
            String projectId = "cbe00bfa-3ce4-4013-b04d-d4fc97339197";
            String tokenAddress = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
            BigDecimal amount = new BigDecimal("0.0021");
            int decimals = 6;
            String serialNo = "ORDER-TEST-001";
            long deadline = Instant.now().getEpochSecond() + 3600;

            System.out.println("Payment Parameters:");
            System.out.println("  chainId: " + chainId);
            System.out.println("  verifyingContract: " + verifyingContract);
            System.out.println("  projectId: " + projectId);
            System.out.println("  token: " + tokenAddress);
            System.out.println("  amount: " + amount + " (" + decimals + " decimals)");
            System.out.println("  serialNo: " + serialNo);
            System.out.println("  deadline: " + deadline);
            System.out.println();

            // Convert addresses for verification
            System.out.println("Converted Addresses:");
            System.out.println("  verifyingContract (hex): " + tronToEvmAddress(verifyingContract));
            System.out.println("  token (hex): " + tronToEvmAddress(tokenAddress));
            System.out.println("  amount (wei): " + amount.multiply(BigDecimal.TEN.pow(decimals)).toBigInteger());
            System.out.println();

            // Generate signature
            String signature = signer.signPayment(
                    chainId,
                    verifyingContract,
                    projectId,
                    tokenAddress,
                    amount,
                    decimals,
                    serialNo,
                    deadline
            );

            System.out.println("Generated Signature: " + signature);
            System.out.println();

            // Output for JS verification
            System.out.println("========================================");
            System.out.println("For JS Verification, use these values:");
            System.out.println("========================================");
            System.out.println("const testParams = {");
            System.out.println("    chainId: " + chainId + "n,");
            System.out.println("    verifyingContract: \"" + verifyingContract + "\",");
            System.out.println("    projectId: \"" + projectId + "\",");
            System.out.println("    token: \"" + tokenAddress + "\",");
            System.out.println("    amount: \"" + amount + "\",");
            System.out.println("    decimals: " + decimals + ",");
            System.out.println("    serialNo: \"" + serialNo + "\",");
            System.out.println("    deadline: " + deadline + "n,");
            System.out.println("    signature: \"" + signature + "\"");
            System.out.println("};");

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}

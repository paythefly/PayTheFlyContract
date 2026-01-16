// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TypeHashes
 * @notice EIP-712 type hashes for signature verification
 * @dev Consistent with EulerPay PayTheFly.sol signature format
 */
library TypeHashes {
    /**
     * @notice EIP-712 typehash for PaymentRequest struct
     * @dev PaymentRequest(string projectId,address token,uint256 amount,string serialNo,uint256 deadline)
     * @dev No payer field - anyone can pay with valid signature
     */
    bytes32 constant PAYMENT_TYPEHASH = keccak256(
        "PaymentRequest(string projectId,address token,uint256 amount,string serialNo,uint256 deadline)"
    );

    /**
     * @notice EIP-712 typehash for WithdrawalRequest struct
     * @dev WithdrawalRequest(address user,string projectId,address token,uint256 amount,string serialNo,uint256 deadline)
     */
    bytes32 constant WITHDRAWAL_TYPEHASH = keccak256(
        "WithdrawalRequest(address user,string projectId,address token,uint256 amount,string serialNo,uint256 deadline)"
    );
}

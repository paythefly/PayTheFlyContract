// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title TypeHashes
 * @notice EIP-712 type hashes for signature verification
 */
library TypeHashes {
    /**
     * @notice EIP-712 typehash for Payment struct
     * @dev Payment(address payer,address token,uint256 amount,string serialNo,uint256 deadline)
     */
    bytes32 constant PAYMENT_TYPEHASH = keccak256(
        "Payment(address payer,address token,uint256 amount,string serialNo,uint256 deadline)"
    );

    /**
     * @notice EIP-712 typehash for Withdrawal struct
     * @dev Withdrawal(address recipient,address token,uint256 amount,string serialNo,uint256 deadline)
     */
    bytes32 constant WITHDRAWAL_TYPEHASH = keccak256(
        "Withdrawal(address recipient,address token,uint256 amount,string serialNo,uint256 deadline)"
    );
}

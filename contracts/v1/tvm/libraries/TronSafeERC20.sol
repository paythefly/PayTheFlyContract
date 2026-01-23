// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title TronSafeERC20
 * @dev Wrappers around ERC20 operations that handle TRON's non-standard behavior.
 *
 * TRON USDT Issue:
 * - Standard ERC20 transfer/transferFrom should return true on success
 * - TRON USDT returns false (0x00..00) even on successful transfers
 * - OpenZeppelin's SafeERC20 reverts if return value is false
 *
 * Solution:
 * - For TRON tokens, we rely on the transfer event and balance changes
 * - instead of checking the return value
 */
library TronSafeERC20 {
    error TronSafeERC20FailedOperation(address token);
    error TronSafeERC20IncorrectAmount(address token, uint256 expected, uint256 received);

    /**
     * @dev Transfer tokens from one address to another.
     * On TRON, we verify success by checking balance changes rather than return value.
     * @param token The ERC20 token
     * @param from Source address
     * @param to Destination address
     * @param amount Amount to transfer
     */
    function safeTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 amount
    ) internal {
        uint256 balanceBefore = token.balanceOf(to);

        // Call transferFrom - don't check return value for TRON compatibility
        (bool success, ) = address(token).call(
            abi.encodeCall(IERC20.transferFrom, (from, to, amount))
        );

        if (!success) {
            revert TronSafeERC20FailedOperation(address(token));
        }

        // Verify the transfer by checking balance change
        uint256 balanceAfter = token.balanceOf(to);
        uint256 received = balanceAfter - balanceBefore;

        // Allow for fee-on-transfer tokens, but ensure we received something
        if (received == 0 && amount > 0) {
            revert TronSafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Transfer tokens from one address to another with exact amount verification.
     * Reverts if received amount doesn't match expected amount (no fee-on-transfer support).
     * @param token The ERC20 token
     * @param from Source address
     * @param to Destination address
     * @param amount Amount to transfer (must match exactly)
     */
    function safeTransferFromExact(
        IERC20 token,
        address from,
        address to,
        uint256 amount
    ) internal {
        uint256 balanceBefore = token.balanceOf(to);

        // Call transferFrom - don't check return value for TRON compatibility
        (bool success, ) = address(token).call(
            abi.encodeCall(IERC20.transferFrom, (from, to, amount))
        );

        if (!success) {
            revert TronSafeERC20FailedOperation(address(token));
        }

        // Verify exact amount was received
        uint256 balanceAfter = token.balanceOf(to);
        uint256 received = balanceAfter - balanceBefore;

        if (received != amount) {
            revert TronSafeERC20IncorrectAmount(address(token), amount, received);
        }
    }

    /**
     * @dev Transfer tokens to a specified address.
     * On TRON, we verify success by checking balance changes rather than return value.
     * @param token The ERC20 token
     * @param to Destination address
     * @param amount Amount to transfer
     */
    function safeTransfer(
        IERC20 token,
        address to,
        uint256 amount
    ) internal {
        uint256 balanceBefore = token.balanceOf(to);

        // Call transfer - don't check return value for TRON compatibility
        (bool success, ) = address(token).call(
            abi.encodeCall(IERC20.transfer, (to, amount))
        );

        if (!success) {
            revert TronSafeERC20FailedOperation(address(token));
        }

        // Verify the transfer by checking balance change
        uint256 balanceAfter = token.balanceOf(to);
        uint256 received = balanceAfter - balanceBefore;

        // Allow for fee-on-transfer tokens, but ensure we received something
        if (received == 0 && amount > 0) {
            revert TronSafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Approve the specified address to spend the specified amount of tokens.
     * TRON USDT approve also returns false on success, so we don't check return value.
     * @param token The ERC20 token
     * @param spender Address to approve
     * @param amount Amount to approve
     */
    function safeApprove(
        IERC20 token,
        address spender,
        uint256 amount
    ) internal {
        (bool success, ) = address(token).call(
            abi.encodeCall(IERC20.approve, (spender, amount))
        );

        if (!success) {
            revert TronSafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Increase the approved amount of tokens.
     * @param token The ERC20 token
     * @param spender Address to increase approval for
     * @param value Amount to increase by
     */
    function safeIncreaseAllowance(
        IERC20 token,
        address spender,
        uint256 value
    ) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        safeApprove(token, spender, oldAllowance + value);
    }

    /**
     * @dev Decrease the approved amount of tokens.
     * @param token The ERC20 token
     * @param spender Address to decrease approval for
     * @param value Amount to decrease by
     */
    function safeDecreaseAllowance(
        IERC20 token,
        address spender,
        uint256 value
    ) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        require(oldAllowance >= value, "TronSafeERC20: decreased allowance below zero");
        safeApprove(token, spender, oldAllowance - value);
    }

    /**
     * @dev Set approval to zero first, then set to new value.
     * Required for some tokens (like USDT) that require allowance to be 0 before setting a new value.
     * @param token The ERC20 token
     * @param spender Address to approve
     * @param amount Amount to approve
     */
    function forceApprove(
        IERC20 token,
        address spender,
        uint256 amount
    ) internal {
        // Try to approve directly first
        (bool success, ) = address(token).call(
            abi.encodeCall(IERC20.approve, (spender, amount))
        );

        // If failed or if we should reset first
        if (!success) {
            // Reset to 0 first
            (bool resetSuccess, ) = address(token).call(
                abi.encodeCall(IERC20.approve, (spender, 0))
            );
            if (!resetSuccess) {
                revert TronSafeERC20FailedOperation(address(token));
            }

            // Then set to new value
            if (amount > 0) {
                (bool setSuccess, ) = address(token).call(
                    abi.encodeCall(IERC20.approve, (spender, amount))
                );
                if (!setSuccess) {
                    revert TronSafeERC20FailedOperation(address(token));
                }
            }
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SafeERC20Universal
 * @dev Universal wrapper for ERC20 operations that handles non-standard token implementations.
 * @custom:security-contact security@example.com
 *
 * ============================================================================
 * BACKGROUND: Why This Library Exists
 * ============================================================================
 *
 * Real-World Bug Example - TRON Mainnet USDT (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t):
 *
 * The TRON USDT contract (Solidity 0.4.18) has a critical bug in StandardTokenWithFees:
 *
 *   ```solidity
 *   function transfer(address _to, uint _value) public returns (bool) {
 *       uint fee = calcFee(_value);
 *       uint sendAmount = _value.sub(fee);
 *       super.transfer(_to, sendAmount);
 *       if (fee > 0) {
 *           super.transfer(owner, fee);
 *       }
 *       // BUG: No return statement! Function declares returns(bool) but returns nothing
 *   }
 *   ```
 *
 * In Solidity 0.4.x, missing return statements default to returning 0 (false).
 * The compiled bytecode returns 32 bytes of zeros instead of true.
 *
 * ============================================================================
 * WHY OPENZEPPELIN SAFEERC20 DOESN'T WORK
 * ============================================================================
 *
 * OpenZeppelin SafeERC20 uses this logic (v5.x):
 *
 *   ```solidity
 *   // returnSize == 0 means no return data (old non-returning tokens)
 *   // returnValue must be 1 (true) if data is returned
 *   if (returnSize == 0 ? address(token).code.length == 0 : returnValue != 1) {
 *       revert SafeERC20FailedOperation(address(token));
 *   }
 *   ```
 *
 * OpenZeppelin handles:
 *   ✅ Standard tokens that return true (returnSize > 0, returnValue == 1)
 *   ✅ Old tokens that return nothing (returnSize == 0)
 *   ❌ Buggy tokens like TRON USDT (returnSize > 0, returnValue == 0)
 *
 * TRON USDT declares `returns (bool)` so the EVM/TVM allocates return space,
 * resulting in returnSize > 0, but the actual value is 0 (false).
 *
 * ============================================================================
 * OUR SOLUTION: Balance Verification
 * ============================================================================
 *
 * Instead of trusting return values, we verify transfers by checking balance changes:
 *
 *   1. Record balance before transfer
 *   2. Execute transfer (ignore return value)
 *   3. Verify balance increased by expected amount
 *
 * This approach is:
 *   ✅ More reliable - doesn't depend on return value implementation
 *   ✅ Universal - works with ANY token regardless of bugs
 *   ✅ Cross-chain - works on both EVM (Ethereum, BSC, etc.) and TVM (TRON)
 *   ⚠️ Slightly higher gas - requires extra balanceOf() calls
 *
 * ============================================================================
 * COMPATIBILITY
 * ============================================================================
 *
 * | Token Type                      | OpenZeppelin | This Library |
 * |---------------------------------|--------------|--------------|
 * | Standard ERC20 (returns true)   | ✅           | ✅           |
 * | Old tokens (no return value)    | ✅           | ✅           |
 * | Buggy tokens (returns false)    | ❌           | ✅           |
 * | Fee-on-transfer tokens          | ✅           | ✅           |
 * | TRON USDT                       | ❌           | ✅           |
 *
 * ============================================================================
 * KNOWN LIMITATIONS
 * ============================================================================
 *
 * 1. Self-Transfer (from == to):
 *    Balance doesn't change on self-transfer, causing false verification failure.
 *    Solution: Check for from == to before balance verification.
 *
 * 2. Rebasing Tokens (stETH, AMPL, etc.):
 *    Balance may change independently of transfers due to rebasing.
 *    This library may not work correctly with rebasing tokens.
 *
 * 3. ERC777/ERC1363 Callbacks:
 *    Tokens with transfer hooks could potentially manipulate balances.
 *    Use ReentrancyGuard in your contract when using this library.
 *
 * 4. Multiple Transfers in Same Transaction:
 *    If multiple transfers to the same address occur, balance verification
 *    is still accurate as each transfer is verified independently.
 *
 * ============================================================================
 */
library SafeERC20Universal {
    error SafeERC20UniversalFailedOperation(address token);
    error SafeERC20UniversalInsufficientReceived(address token, uint256 expected, uint256 received);

    /**
     * @dev Internal helper: execute low-level call and revert if failed
     */
    function _callToken(IERC20 token, bytes memory data) private {
        (bool success, ) = address(token).call(data);
        if (!success) {
            revert SafeERC20UniversalFailedOperation(address(token));
        }
    }

    /**
     * @dev Transfer tokens from one address to another.
     * Verifies success by checking balance changes rather than return value.
     * @param token The ERC20 token
     * @param from Source address
     * @param to Destination address
     * @param amount Amount to transfer
     * @notice Allows fee-on-transfer tokens (received amount may be less than requested)
     */
    function safeTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 amount
    ) internal {
        if (amount == 0) return;

        bytes memory callData = abi.encodeCall(IERC20.transferFrom, (from, to, amount));

        // Handle self-transfer edge case: balance won't change
        if (from == to) {
            _callToken(token, callData);
            return;
        }

        uint256 balanceBefore = token.balanceOf(to);
        _callToken(token, callData);
        uint256 received = token.balanceOf(to) - balanceBefore;

        if (received == 0) {
            revert SafeERC20UniversalFailedOperation(address(token));
        }
    }

    /**
     * @dev Transfer tokens with exact amount verification.
     * Reverts if received amount doesn't match expected amount.
     * @param token The ERC20 token
     * @param from Source address
     * @param to Destination address
     * @param amount Amount to transfer (must match exactly)
     * @notice Does NOT support fee-on-transfer tokens
     */
    function safeTransferFromExact(
        IERC20 token,
        address from,
        address to,
        uint256 amount
    ) internal {
        if (amount == 0) return;

        bytes memory callData = abi.encodeCall(IERC20.transferFrom, (from, to, amount));

        // Handle self-transfer edge case
        if (from == to) {
            _callToken(token, callData);
            return;
        }

        uint256 balanceBefore = token.balanceOf(to);
        _callToken(token, callData);
        uint256 received = token.balanceOf(to) - balanceBefore;

        if (received != amount) {
            revert SafeERC20UniversalInsufficientReceived(address(token), amount, received);
        }
    }

    /**
     * @dev Transfer tokens to a specified address.
     * Verifies success by checking balance changes rather than return value.
     * @param token The ERC20 token
     * @param to Destination address
     * @param amount Amount to transfer
     * @notice Allows fee-on-transfer tokens (received amount may be less than requested)
     */
    function safeTransfer(
        IERC20 token,
        address to,
        uint256 amount
    ) internal {
        if (amount == 0) return;

        bytes memory callData = abi.encodeCall(IERC20.transfer, (to, amount));

        // Handle self-transfer edge case (transfer to self)
        if (to == address(this)) {
            _callToken(token, callData);
            return;
        }

        uint256 balanceBefore = token.balanceOf(to);
        _callToken(token, callData);
        uint256 received = token.balanceOf(to) - balanceBefore;

        if (received == 0) {
            revert SafeERC20UniversalFailedOperation(address(token));
        }
    }

    /**
     * @dev Transfer tokens with exact amount verification.
     * @param token The ERC20 token
     * @param to Destination address
     * @param amount Amount to transfer (must match exactly)
     * @notice Does NOT support fee-on-transfer tokens
     */
    function safeTransferExact(
        IERC20 token,
        address to,
        uint256 amount
    ) internal {
        if (amount == 0) return;

        bytes memory callData = abi.encodeCall(IERC20.transfer, (to, amount));

        // Handle self-transfer edge case
        if (to == address(this)) {
            _callToken(token, callData);
            return;
        }

        uint256 balanceBefore = token.balanceOf(to);
        _callToken(token, callData);
        uint256 received = token.balanceOf(to) - balanceBefore;

        if (received != amount) {
            revert SafeERC20UniversalInsufficientReceived(address(token), amount, received);
        }
    }

    /**
     * @dev Approve the specified address to spend tokens.
     * @param token The ERC20 token
     * @param spender Address to approve
     * @param amount Amount to approve
     */
    function safeApprove(
        IERC20 token,
        address spender,
        uint256 amount
    ) internal {
        _callToken(token, abi.encodeCall(IERC20.approve, (spender, amount)));
    }

    /**
     * @dev Increase the approved amount of tokens.
     * @param token The ERC20 token
     * @param spender Address to increase approval for
     * @param addedValue Amount to increase by
     */
    function safeIncreaseAllowance(
        IERC20 token,
        address spender,
        uint256 addedValue
    ) internal {
        uint256 currentAllowance = token.allowance(address(this), spender);
        safeApprove(token, spender, currentAllowance + addedValue);
    }

    /**
     * @dev Decrease the approved amount of tokens.
     * @param token The ERC20 token
     * @param spender Address to decrease approval for
     * @param subtractedValue Amount to decrease by
     */
    function safeDecreaseAllowance(
        IERC20 token,
        address spender,
        uint256 subtractedValue
    ) internal {
        uint256 currentAllowance = token.allowance(address(this), spender);
        require(currentAllowance >= subtractedValue, "SafeERC20Universal: decreased allowance below zero");
        safeApprove(token, spender, currentAllowance - subtractedValue);
    }

    /**
     * @dev Set approval with force reset pattern.
     * Some tokens (like USDT) require allowance to be 0 before setting a new value.
     * @param token The ERC20 token
     * @param spender Address to approve
     * @param amount Amount to approve
     */
    function forceApprove(
        IERC20 token,
        address spender,
        uint256 amount
    ) internal {
        // Try direct approve first
        (bool success, bytes memory data) = address(token).call(
            abi.encodeCall(IERC20.approve, (spender, amount))
        );

        // Check if we need to reset first
        bool needsReset = !success || (data.length > 0 && !abi.decode(data, (bool)));

        if (needsReset) {
            // Reset to 0 first
            _callToken(token, abi.encodeCall(IERC20.approve, (spender, 0)));

            // Then set to new value
            if (amount > 0) {
                _callToken(token, abi.encodeCall(IERC20.approve, (spender, amount)));
            }
        }
    }
}

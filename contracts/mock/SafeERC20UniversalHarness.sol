// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/SafeERC20Universal.sol";

/**
 * @title SafeERC20UniversalHarness
 * @notice Test harness contract to expose SafeERC20Universal library functions
 * @dev Used for comprehensive testing of the library including edge cases
 */
contract SafeERC20UniversalHarness {
    using SafeERC20Universal for IERC20;

    // Events for testing
    event TransferCompleted(address token, address to, uint256 amount);
    event TransferFromCompleted(address token, address from, address to, uint256 amount);
    event ApprovalCompleted(address token, address spender, uint256 amount);

    /**
     * @dev Test safeTransfer function
     */
    function testSafeTransfer(
        IERC20 token,
        address to,
        uint256 amount
    ) external {
        token.safeTransfer(to, amount);
        emit TransferCompleted(address(token), to, amount);
    }

    /**
     * @dev Test safeTransferExact function
     */
    function testSafeTransferExact(
        IERC20 token,
        address to,
        uint256 amount
    ) external {
        token.safeTransferExact(to, amount);
        emit TransferCompleted(address(token), to, amount);
    }

    /**
     * @dev Test safeTransferFrom function
     */
    function testSafeTransferFrom(
        IERC20 token,
        address from,
        address to,
        uint256 amount
    ) external {
        token.safeTransferFrom(from, to, amount);
        emit TransferFromCompleted(address(token), from, to, amount);
    }

    /**
     * @dev Test safeTransferFromExact function
     */
    function testSafeTransferFromExact(
        IERC20 token,
        address from,
        address to,
        uint256 amount
    ) external {
        token.safeTransferFromExact(from, to, amount);
        emit TransferFromCompleted(address(token), from, to, amount);
    }

    /**
     * @dev Test safeApprove function
     */
    function testSafeApprove(
        IERC20 token,
        address spender,
        uint256 amount
    ) external {
        token.safeApprove(spender, amount);
        emit ApprovalCompleted(address(token), spender, amount);
    }

    /**
     * @dev Test safeIncreaseAllowance function
     */
    function testSafeIncreaseAllowance(
        IERC20 token,
        address spender,
        uint256 addedValue
    ) external {
        token.safeIncreaseAllowance(spender, addedValue);
        emit ApprovalCompleted(address(token), spender, addedValue);
    }

    /**
     * @dev Test safeDecreaseAllowance function
     */
    function testSafeDecreaseAllowance(
        IERC20 token,
        address spender,
        uint256 subtractedValue
    ) external {
        token.safeDecreaseAllowance(spender, subtractedValue);
        emit ApprovalCompleted(address(token), spender, subtractedValue);
    }

    /**
     * @dev Test forceApprove function
     */
    function testForceApprove(
        IERC20 token,
        address spender,
        uint256 amount
    ) external {
        token.forceApprove(spender, amount);
        emit ApprovalCompleted(address(token), spender, amount);
    }

    /**
     * @dev Test self-transfer edge case (transfer to self)
     */
    function testSelfTransfer(
        IERC20 token,
        uint256 amount
    ) external {
        token.safeTransfer(address(this), amount);
        emit TransferCompleted(address(token), address(this), amount);
    }

    /**
     * @dev Test self-transferFrom edge case (from == to)
     */
    function testSelfTransferFrom(
        IERC20 token,
        address account,
        uint256 amount
    ) external {
        token.safeTransferFrom(account, account, amount);
        emit TransferFromCompleted(address(token), account, account, amount);
    }

    /**
     * @dev Test self-transferFromExact edge case (from == to)
     */
    function testSelfTransferFromExact(
        IERC20 token,
        address account,
        uint256 amount
    ) external {
        token.safeTransferFromExact(account, account, amount);
        emit TransferFromCompleted(address(token), account, account, amount);
    }

    /**
     * @dev Test safeTransferExact self-transfer (to == address(this))
     */
    function testSelfTransferExact(
        IERC20 token,
        uint256 amount
    ) external {
        token.safeTransferExact(address(this), amount);
        emit TransferCompleted(address(token), address(this), amount);
    }

    /**
     * @dev Helper to receive tokens for testing
     */
    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SafeERC20Test
 * @dev Test contract to diagnose SafeERC20 issues with non-standard tokens (like Tron USDT)
 */
contract SafeERC20Test {
    using SafeERC20 for IERC20;

    // Events for logging test results
    event TestResult(string method, bool success, bytes returnData);
    event TransferAttempted(string method, address token, address to, uint256 amount);

    /**
     * @dev Test 1: Use SafeERC20.safeTransfer (OpenZeppelin standard)
     * This may fail with non-standard tokens
     */
    function testSafeTransfer(address token, address to, uint256 amount) external {
        emit TransferAttempted("SafeERC20.safeTransfer", token, to, amount);
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @dev Test 2: Use SafeERC20.safeTransferFrom (OpenZeppelin standard)
     * This may fail with non-standard tokens
     */
    function testSafeTransferFrom(address token, address from, address to, uint256 amount) external {
        emit TransferAttempted("SafeERC20.safeTransferFrom", token, to, amount);
        IERC20(token).safeTransferFrom(from, to, amount);
    }

    /**
     * @dev Test 3: Direct low-level call to check return data
     * Returns raw return data for analysis
     */
    function testRawTransfer(address token, address to, uint256 amount) external returns (bool success, bytes memory returnData) {
        emit TransferAttempted("rawCall.transfer", token, to, amount);

        bytes memory data = abi.encodeWithSelector(IERC20.transfer.selector, to, amount);
        (success, returnData) = token.call(data);

        emit TestResult("rawCall.transfer", success, returnData);
        return (success, returnData);
    }

    /**
     * @dev Test 4: Direct low-level call for transferFrom
     */
    function testRawTransferFrom(address token, address from, address to, uint256 amount) external returns (bool success, bytes memory returnData) {
        emit TransferAttempted("rawCall.transferFrom", token, to, amount);

        bytes memory data = abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount);
        (success, returnData) = token.call(data);

        emit TestResult("rawCall.transferFrom", success, returnData);
        return (success, returnData);
    }

    /**
     * @dev Test 5: Check return data size and value (same logic as SafeERC20)
     */
    function analyzeTransferReturn(address token, address to, uint256 amount) external returns (
        bool callSuccess,
        uint256 returnSize,
        uint256 returnValue,
        bytes memory fullReturnData
    ) {
        bytes memory data = abi.encodeWithSelector(IERC20.transfer.selector, to, amount);

        assembly {
            callSuccess := call(gas(), token, 0, add(data, 0x20), mload(data), 0, 0x20)
            returnSize := returndatasize()
            returnValue := mload(0)
        }

        // Also get full return data
        fullReturnData = new bytes(returnSize);
        assembly {
            returndatacopy(add(fullReturnData, 0x20), 0, returndatasize())
        }

        emit TestResult(
            "analyzeTransfer",
            callSuccess,
            abi.encode(returnSize, returnValue, fullReturnData)
        );
    }

    /**
     * @dev Test 6: Custom safe transfer that handles non-standard tokens
     * More permissive: only requires call success, ignores return data
     */
    function customSafeTransfer(address token, address to, uint256 amount) external returns (bool) {
        emit TransferAttempted("customSafeTransfer", token, to, amount);

        bytes memory data = abi.encodeWithSelector(IERC20.transfer.selector, to, amount);
        (bool success, bytes memory returnData) = token.call(data);

        // Only check call success
        // For non-standard tokens: success is enough
        // For standard tokens: also verify return value if present
        bool result = success && (returnData.length == 0 || abi.decode(returnData, (bool)));

        emit TestResult("customSafeTransfer", result, returnData);
        return result;
    }

    /**
     * @dev Test 7: Most permissive transfer - only checks call success
     * WARNING: Less safe, but works with all tokens
     */
    function permissiveTransfer(address token, address to, uint256 amount) external returns (bool) {
        emit TransferAttempted("permissiveTransfer", token, to, amount);

        (bool success,) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));

        emit TestResult("permissiveTransfer", success, "");
        return success;
    }

    /**
     * @dev Approve tokens (needed before transferFrom tests)
     */
    function approve(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }

    /**
     * @dev Get token balance
     */
    function getBalance(address token, address account) external view returns (uint256) {
        return IERC20(token).balanceOf(account);
    }

    /**
     * @dev Get token allowance
     */
    function getAllowance(address token, address owner, address spender) external view returns (uint256) {
        return IERC20(token).allowance(owner, spender);
    }

    /**
     * @dev Receive tokens (for testing)
     */
    receive() external payable {}
}

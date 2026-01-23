// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ChainIdHelper
 * @notice Minimal helper contract to get block.chainid for testing
 */
contract ChainIdHelper {
    function getChainId() external view returns (uint256) {
        return block.chainid;
    }
}

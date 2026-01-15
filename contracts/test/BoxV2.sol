// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BoxV1.sol";

/**
 * @title BoxV2 - Upgraded version of Box
 * @dev Adds increment function
 */
contract BoxV2 is BoxV1 {
    function increment() public {
        store(retrieve() + 1);
    }

    function version() public pure virtual override returns (string memory) {
        return "V2";
    }
}

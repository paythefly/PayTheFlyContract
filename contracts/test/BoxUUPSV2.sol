// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BoxUUPSV1.sol";

/**
 * @title BoxUUPSV2 - Upgraded version of BoxUUPS
 */
contract BoxUUPSV2 is BoxUUPSV1 {
    function increment() public {
        store(retrieve() + 1);
    }

    function version() public pure virtual override returns (string memory) {
        return "UUPS-V2";
    }
}

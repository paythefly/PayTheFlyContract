// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Imports
 * @notice Import external contracts to ensure they are compiled into artifacts.
 * @dev This file serves as a compilation helper for contracts that are:
 *      - Used by deployment scripts but not directly referenced in application code
 *      - Required for TVM (TRON) deployment where hardhat-upgrades is not available
 *
 * Why this is needed:
 *      - On EVM chains, hardhat-upgrades plugin handles proxy deployment automatically
 *      - On TVM (TRON), we manually deploy proxies using compiled artifacts
 *      - Without explicit imports, these contracts won't be compiled into artifacts-tron/
 *
 * Usage:
 *      - EVM deployment: Uses @openzeppelin/hardhat-upgrades (automatic)
 *      - TVM deployment: Uses artifacts from this import (manual proxy deployment)
 */

// ERC1967Proxy: UUPS proxy contract for PayTheFlyProFactory deployment on TVM
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

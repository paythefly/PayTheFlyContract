// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title BoxUUPSV1 - Test contract for UUPS proxy pattern
 */
contract BoxUUPSV1 is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    uint256 private _value;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        _value = 0;
    }

    function store(uint256 value) public {
        _value = value;
    }

    function retrieve() public view returns (uint256) {
        return _value;
    }

    function version() public pure virtual returns (string memory) {
        return "UUPS-V1";
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SimpleBox - Simple implementation contract for proxy testing
 */
contract SimpleBox {
    uint256 private _value;
    address private _owner;
    bool private _initialized;

    modifier onlyOwner() {
        require(msg.sender == _owner, "Not owner");
        _;
    }

    function initialize(address owner_) external {
        require(!_initialized, "Already initialized");
        _initialized = true;
        _owner = owner_;
    }

    function store(uint256 value) external {
        _value = value;
    }

    function retrieve() external view returns (uint256) {
        return _value;
    }

    function owner() external view returns (address) {
        return _owner;
    }

    function version() external pure virtual returns (string memory) {
        return "V1";
    }
}

/**
 * @title SimpleBoxV2 - Upgraded version
 */
contract SimpleBoxV2 is SimpleBox {
    function increment() external {
        uint256 current = this.retrieve();
        this.store(current + 1);
    }

    function version() external pure virtual override returns (string memory) {
        return "V2";
    }
}

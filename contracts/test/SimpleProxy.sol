// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SimpleTransparentProxy - Simplified Transparent Proxy for testing
 * @dev ERC1967 storage slots for implementation and admin
 */
contract SimpleTransparentProxy {
    // ERC1967 slots
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 private constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    constructor(address implementation_, address admin_, bytes memory data_) {
        _setAdmin(admin_);
        _setImplementation(implementation_);
        if (data_.length > 0) {
            (bool success,) = implementation_.delegatecall(data_);
            require(success, "Init failed");
        }
    }

    function _getAdmin() internal view returns (address admin) {
        bytes32 slot = ADMIN_SLOT;
        assembly {
            admin := sload(slot)
        }
    }

    function _setAdmin(address admin_) internal {
        bytes32 slot = ADMIN_SLOT;
        assembly {
            sstore(slot, admin_)
        }
    }

    function _getImplementation() internal view returns (address impl) {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            impl := sload(slot)
        }
    }

    function _setImplementation(address impl_) internal {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            sstore(slot, impl_)
        }
    }

    // Admin functions (only callable by admin)
    function admin() external view returns (address) {
        require(msg.sender == _getAdmin(), "Not admin");
        return _getAdmin();
    }

    function implementation() external view returns (address) {
        require(msg.sender == _getAdmin(), "Not admin");
        return _getImplementation();
    }

    function upgradeTo(address newImplementation) external {
        require(msg.sender == _getAdmin(), "Not admin");
        _setImplementation(newImplementation);
    }

    function upgradeToAndCall(address newImplementation, bytes memory data) external {
        require(msg.sender == _getAdmin(), "Not admin");
        _setImplementation(newImplementation);
        if (data.length > 0) {
            (bool success,) = newImplementation.delegatecall(data);
            require(success, "Upgrade call failed");
        }
    }

    // Fallback - delegate to implementation
    fallback() external payable {
        address impl = _getImplementation();
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}

/**
 * @title SimpleUUPSProxy - Simplified UUPS Proxy for testing
 */
contract SimpleUUPSProxy {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation_, bytes memory data_) {
        _setImplementation(implementation_);
        if (data_.length > 0) {
            (bool success,) = implementation_.delegatecall(data_);
            require(success, "Init failed");
        }
    }

    function _getImplementation() internal view returns (address impl) {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            impl := sload(slot)
        }
    }

    function _setImplementation(address impl_) internal {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            sstore(slot, impl_)
        }
    }

    fallback() external payable {
        address impl = _getImplementation();
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}

/**
 * @title SimpleBeacon - Simplified Beacon for testing
 */
contract SimpleBeacon {
    address private _implementation;
    address private _owner;

    event Upgraded(address indexed implementation);

    constructor(address implementation_, address owner_) {
        _implementation = implementation_;
        _owner = owner_;
    }

    function implementation() external view returns (address) {
        return _implementation;
    }

    function upgradeTo(address newImplementation) external {
        require(msg.sender == _owner, "Not owner");
        _implementation = newImplementation;
        emit Upgraded(newImplementation);
    }
}

/**
 * @title SimpleBeaconProxy - Simplified Beacon Proxy for testing
 */
contract SimpleBeaconProxy {
    bytes32 private constant BEACON_SLOT = 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;

    constructor(address beacon_, bytes memory data_) {
        _setBeacon(beacon_);
        address impl = SimpleBeacon(beacon_).implementation();
        if (data_.length > 0) {
            (bool success,) = impl.delegatecall(data_);
            require(success, "Init failed");
        }
    }

    function _getBeacon() internal view returns (address beacon) {
        bytes32 slot = BEACON_SLOT;
        assembly {
            beacon := sload(slot)
        }
    }

    function _setBeacon(address beacon_) internal {
        bytes32 slot = BEACON_SLOT;
        assembly {
            sstore(slot, beacon_)
        }
    }

    fallback() external payable {
        address beacon = _getBeacon();
        address impl = SimpleBeacon(beacon).implementation();
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}

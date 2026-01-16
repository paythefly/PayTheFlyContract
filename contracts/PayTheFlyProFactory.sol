// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {IPayTheFlyProFactory} from "./interfaces/IPayTheFlyProFactory.sol";
import {IPayTheFlyPro} from "./interfaces/IPayTheFlyPro.sol";
import {DataTypes} from "./libraries/DataTypes.sol";
import {Errors} from "./libraries/Errors.sol";

/**
 * @title PayTheFlyProFactory
 * @notice Factory contract for creating and managing project contracts
 * @dev Uses UUPS proxy pattern for upgradeability and UpgradeableBeacon for project implementations
 */
contract PayTheFlyProFactory is IPayTheFlyProFactory, UUPSUpgradeable, Ownable2StepUpgradeable {
    // ============ Storage ============

    /// @notice The UpgradeableBeacon contract managing project implementations
    UpgradeableBeacon private _beacon;

    /// @notice Address where fees are collected
    address private _feeVault;

    /// @notice Fee rate in basis points (10000 = 100%)
    uint256 private _feeRate;

    /// @notice Mapping from project ID to project contract address
    mapping(string => address) private _projects;

    /// @notice Mapping to check if project ID exists
    mapping(string => bool) private _projectExists;

    // ============ Constructor ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Initializer ============

    /**
     * @notice Initialize the factory contract
     * @param projectImplementation The initial project implementation address
     * @param initialFeeVault The initial fee vault address
     * @param initialFeeRate The initial fee rate in basis points
     */
    function initialize(
        address projectImplementation,
        address initialFeeVault,
        uint256 initialFeeRate
    ) external initializer {
        __UUPSUpgradeable_init();
        __Ownable2Step_init();
        __Ownable_init(msg.sender);

        if (initialFeeVault == address(0)) revert InvalidFeeVault();
        if (initialFeeRate > DataTypes.MAX_FEE_RATE) revert FeeRateTooHigh();

        // Deploy the beacon with the initial implementation
        _beacon = new UpgradeableBeacon(projectImplementation, address(this));
        _feeVault = initialFeeVault;
        _feeRate = initialFeeRate;
    }

    // ============ View Functions ============

    /// @inheritdoc IPayTheFlyProFactory
    function beacon() external view override returns (address) {
        return address(_beacon);
    }

    /// @inheritdoc IPayTheFlyProFactory
    function feeVault() external view override returns (address) {
        return _feeVault;
    }

    /// @inheritdoc IPayTheFlyProFactory
    function feeRate() external view override returns (uint256) {
        return _feeRate;
    }

    /// @inheritdoc IPayTheFlyProFactory
    function getProject(string calldata projectId) external view override returns (address) {
        return _projects[projectId];
    }

    /// @inheritdoc IPayTheFlyProFactory
    function projectExists(string calldata projectId) external view override returns (bool) {
        return _projectExists[projectId];
    }

    /// @inheritdoc IPayTheFlyProFactory
    function pendingOwner() public view override(IPayTheFlyProFactory, Ownable2StepUpgradeable) returns (address) {
        return super.pendingOwner();
    }

    // ============ Project Creation ============

    /// @inheritdoc IPayTheFlyProFactory
    function createProject(
        string calldata projectId,
        string calldata name,
        address admin,
        address signer
    ) external override returns (address projectAddress) {
        // Validate inputs
        if (bytes(projectId).length == 0) revert ProjectIdEmpty();
        if (bytes(projectId).length > DataTypes.MAX_PROJECT_ID_LENGTH) revert ProjectIdTooLong();
        if (_projectExists[projectId]) revert ProjectAlreadyExists();
        if (admin == address(0)) revert InvalidAdminAddress();
        if (signer == address(0)) revert Errors.InvalidSignerAddress();

        // Deploy BeaconProxy
        bytes memory initData = abi.encodeWithSelector(
            IPayTheFlyPro.initialize.selector,
            projectId,
            name,
            msg.sender,  // creator
            admin,
            signer
        );

        BeaconProxy proxy = new BeaconProxy(address(_beacon), initData);
        projectAddress = address(proxy);

        // Register project
        _projects[projectId] = projectAddress;
        _projectExists[projectId] = true;

        emit ProjectCreated(projectId, projectAddress, msg.sender, admin, name);
    }

    // ============ Admin Functions ============

    /// @inheritdoc IPayTheFlyProFactory
    function setFeeVault(address newFeeVault) external override onlyOwner {
        if (newFeeVault == address(0)) revert InvalidFeeVault();

        address oldVault = _feeVault;
        _feeVault = newFeeVault;

        emit FeeVaultUpdated(oldVault, newFeeVault);
    }

    /// @inheritdoc IPayTheFlyProFactory
    function setFeeRate(uint256 newFeeRate) external override onlyOwner {
        if (newFeeRate > DataTypes.MAX_FEE_RATE) revert FeeRateTooHigh();

        uint256 oldRate = _feeRate;
        _feeRate = newFeeRate;

        emit FeeRateUpdated(oldRate, newFeeRate);
    }

    /// @inheritdoc IPayTheFlyProFactory
    function upgradeBeacon(address newImplementation) external override onlyOwner {
        // Validate new implementation is a contract
        if (newImplementation.code.length == 0) revert Errors.InvalidImplementation();

        address oldImpl = _beacon.implementation();
        _beacon.upgradeTo(newImplementation);

        emit BeaconUpgraded(oldImpl, newImplementation);
    }

    // ============ Ownership Functions ============

    /// @inheritdoc IPayTheFlyProFactory
    function transferOwnership(address newOwner) public override(IPayTheFlyProFactory, Ownable2StepUpgradeable) onlyOwner {
        super.transferOwnership(newOwner);
    }

    /// @inheritdoc IPayTheFlyProFactory
    function acceptOwnership() public override(IPayTheFlyProFactory, Ownable2StepUpgradeable) {
        super.acceptOwnership();
    }

    /// @inheritdoc IPayTheFlyProFactory
    function cancelOwnershipTransfer() external override onlyOwner {
        _transferOwnership(owner());
    }

    // ============ UUPS Upgrade ============

    /// @dev Required by UUPS pattern
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}

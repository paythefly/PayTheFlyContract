// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IPayTheFlyProFactory
 * @notice Interface for the Project Factory contract
 * @dev Factory uses UUPS upgradeable pattern and manages UpgradeableBeacon for project contracts
 */
interface IPayTheFlyProFactory {
    // ============ Events ============

    /// @notice Emitted when a new project is created
    event ProjectCreated(
        string indexed projectId,
        address indexed projectAddress,
        address indexed creator,
        address admin,
        string name
    );

    /// @notice Emitted when fee vault is updated
    event FeeVaultUpdated(address indexed oldVault, address indexed newVault);

    /// @notice Emitted when fee rate is updated
    event FeeRateUpdated(uint256 oldRate, uint256 newRate);

    /// @notice Emitted when beacon implementation is upgraded
    event BeaconUpgraded(address indexed oldImpl, address indexed newImpl);

    /// @notice Emitted when ownership transfer is cancelled
    event OwnershipTransferCancelled(address indexed owner);

    // ============ Errors ============

    error ProjectIdEmpty();
    error ProjectIdTooLong();
    error ProjectAlreadyExists();
    error InvalidAdminAddress();
    error InvalidFeeVault();
    error FeeRateTooHigh();

    // ============ View Functions ============

    /**
     * @notice Get the beacon contract address
     * @return The UpgradeableBeacon contract address
     */
    function beacon() external view returns (address);

    /**
     * @notice Get the fee vault address
     * @return The address where fees are collected
     */
    function feeVault() external view returns (address);

    /**
     * @notice Get the fee rate
     * @return The fee rate in basis points (10000 = 100%)
     */
    function feeRate() external view returns (uint256);

    /**
     * @notice Get project contract address by project ID
     * @param projectId The unique project identifier
     * @return The project contract address, or address(0) if not exists
     */
    function getProject(string calldata projectId) external view returns (address);

    /**
     * @notice Check if a project exists
     * @param projectId The unique project identifier
     * @return True if the project exists
     */
    function projectExists(string calldata projectId) external view returns (bool);

    /**
     * @notice Get the pending owner address (for two-step ownership transfer)
     * @return The pending owner address
     */
    function pendingOwner() external view returns (address);

    // ============ State-Changing Functions ============

    /**
     * @notice Create a new project contract
     * @param projectId Unique identifier for the project (max 128 chars)
     * @param name Project name (max 256 chars)
     * @param admin Initial admin address
     * @param signer Initial signer address for payment/withdrawal signatures
     * @return projectAddress The deployed project contract address
     */
    function createProject(
        string calldata projectId,
        string calldata name,
        address admin,
        address signer
    ) external returns (address projectAddress);

    /**
     * @notice Update the fee vault address
     * @param newFeeVault The new fee vault address
     */
    function setFeeVault(address newFeeVault) external;

    /**
     * @notice Update the fee rate
     * @param newFeeRate The new fee rate in basis points (max 1000 = 10%)
     */
    function setFeeRate(uint256 newFeeRate) external;

    /**
     * @notice Upgrade the beacon to a new implementation
     * @param newImplementation The new implementation contract address
     */
    function upgradeBeacon(address newImplementation) external;

    /**
     * @notice Initiate ownership transfer (two-step)
     * @param newOwner The address of the new owner
     */
    function transferOwnership(address newOwner) external;

    /**
     * @notice Accept ownership transfer (must be called by pending owner)
     */
    function acceptOwnership() external;

    /**
     * @notice Cancel pending ownership transfer
     */
    function cancelOwnershipTransfer() external;
}

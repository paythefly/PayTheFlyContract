// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DataTypes
 * @notice Shared data types for the Project Payment System
 */
library DataTypes {
    // ============ Constants ============

    /// @notice Maximum fee rate (10% = 1000 basis points)
    uint256 constant MAX_FEE_RATE = 1000;

    /// @notice Basis points denominator (10000 = 100%)
    uint256 constant BASIS_POINTS = 10000;

    /// @notice Maximum project ID length
    uint256 constant MAX_PROJECT_ID_LENGTH = 128;

    /// @notice Maximum project name length
    uint256 constant MAX_NAME_LENGTH = 256;

    /// @notice Maximum serial number length
    uint256 constant MAX_SERIAL_NO_LENGTH = 128;

    /// @notice Maximum number of admins per project
    uint256 constant MAX_ADMINS = 20;

    /// @notice Minimum proposal duration (1 hour)
    uint256 constant MIN_PROPOSAL_DURATION = 1 hours;

    /// @notice Maximum proposal duration (30 days)
    uint256 constant MAX_PROPOSAL_DURATION = 30 days;

    // ============ Enums ============

    /**
     * @notice Operation types for multi-sig proposals
     */
    enum OperationType {
        SetSigner,           // 0: Set new signer address
        AddAdmin,            // 1: Add new admin
        RemoveAdmin,         // 2: Remove admin
        ChangeThreshold,     // 3: Change multi-sig threshold
        AdminWithdraw,       // 4: Withdraw from payment pool
        WithdrawFromPool,    // 5: Withdraw from withdrawal pool
        Pause,               // 6: Pause the project
        Unpause,             // 7: Unpause the project
        EmergencyWithdraw    // 8: Emergency withdraw all funds
    }

    // ============ Structs ============

    /**
     * @notice Internal proposal storage structure
     */
    struct Proposal {
        uint256 id;
        OperationType opType;
        bytes params;
        address proposer;
        uint256 deadline;
        uint256 confirmCount;
        bool executed;
        bool cancelled;
    }

    /**
     * @notice Project information for external view
     */
    struct ProjectInfo {
        string projectId;
        string name;
        address creator;
        address signer;
        bool paused;
        address[] admins;
        uint256 threshold;
        uint256 activeProposalCount;
    }

    /**
     * @notice Token balance information
     */
    struct TokenBalance {
        uint256 paymentBalance;
        uint256 withdrawalBalance;
    }

    /**
     * @notice Proposal information for external view
     */
    struct ProposalInfo {
        uint256 id;
        OperationType opType;
        bytes params;
        address proposer;
        uint256 deadline;
        uint256 confirmCount;
        bool executed;
        bool cancelled;
        address[] confirmedBy;
    }
}

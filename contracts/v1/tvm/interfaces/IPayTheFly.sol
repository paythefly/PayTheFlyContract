// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPayTheFly {
    // Structs
    struct Project {
        string projectId;  // Unique identifier for the project
        string name;       // Name of the project
        address creator; // Address of the project creator
        address signer;  // Authorized signer for withdrawal verification
        bool active;      // Whether the project is active
    }

    struct ProjectBalance {
        uint256 paymentBalance;    // Balance from user payments (can be withdrawn by project owner)
        uint256 withdrawalBalance; // Balance deposited by project owner for user withdrawals
    }

    struct WithdrawalRequest {
        address user;           // Target user address (REQUIRED, must match msg.sender, cannot be address(0))
        string projectId;       // Project ID for the withdrawal
        address token;          // Token address (address(0) for ETH)
        uint256 amount;         // Amount to withdraw
        string serialNo;        // Unique withdrawal serial number (unique per project)
        uint256 deadline;       // Deadline timestamp for the withdrawal
    }

    struct PaymentRequest {
        string projectId;       // Project ID for the payment
        address token;          // Token address (address(0) for ETH)
        uint256 amount;         // Amount to pay
        string serialNo;        // Unique payment serial number
        uint256 deadline;       // Deadline timestamp for the payment
    }

    // Transaction types for unified event
    enum TxType {
        NONE,                 // 0 - Reserved
        PAYMENT,              // 1 - User payment
        WITHDRAWAL,           // 2 - User withdrawal (with signature)
        ADMIN_WITHDRAWAL,     // 3 - Project creator withdraws payment balance
        POOL_DEPOSIT,         // 4 - Project creator deposits to withdrawal pool
        POOL_WITHDRAW         // 5 - Project creator withdraws from withdrawal pool
    }

    // Events
    event ProjectCreated(
        string projectId,
        string name,
        address creator,
        address signer
    );

    event ProjectUpdated(
        string projectId,
        string name,
        address signer
    );

    event ProjectStatusChanged(
        string projectId,
        bool active
    );

    event Transaction(
        string projectId,
        address token,
        address account,
        uint256 amount,
        uint256 fee,
        string serialNo,
        TxType txType
    );

    event Paused(address account);
    event Unpaused(address account);

    // Functions
    function createProject(
        string calldata projectId,
        string calldata name,
        address signer
    ) external;

    function updateProject(
        string calldata projectId,
        string calldata name,
        address signer
    ) external;

    function setProjectStatus(
        string calldata projectId,
        bool active
    ) external;

    function pay(
        PaymentRequest calldata request,
        bytes calldata signature
    ) external payable;

    function payWithSign(
        PaymentRequest calldata request,
        bytes calldata signature
    ) external payable;

    function withdraw(
        WithdrawalRequest calldata request,
        bytes calldata signature
    ) external payable;

    function adminWithdraw(
        string calldata projectId,
        address token,
        uint256 amount,
        address recipient
    ) external;

    function depositToWithdrawalPool(
        string calldata projectId,
        address token,
        uint256 amount
    ) external payable;

    function withdrawFromWithdrawalPool(
        string calldata projectId,
        address token,
        uint256 amount,
        address recipient
    ) external;

    function pause() external;

    function unpause() external;

    function getProject(string calldata projectId) external view returns (Project memory);

    function getProjectBalance(
        string calldata projectId,
        address token
    ) external view returns (ProjectBalance memory);

    function isPaymentSerialNoUsed(
        string calldata projectId,
        string calldata serialNo
    ) external view returns (bool);

    function isWithdrawalSerialNoUsed(
        string calldata projectId,
        string calldata serialNo
    ) external view returns (bool);

    function getCreatorProjects(address creator) external view returns (string[] memory);

    function getCreatorProjectsPaginated(
        address creator,
        uint256 offset,
        uint256 limit
    ) external view returns (string[] memory projectIds, uint256 total);

    function getCreatorProjectCount(address creator) external view returns (uint256);
}

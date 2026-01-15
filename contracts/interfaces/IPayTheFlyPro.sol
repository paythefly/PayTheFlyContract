// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IPayTheFlyPro
 * @notice Interface for the Project contract
 * @dev Project contracts are deployed as BeaconProxy instances
 */
interface IPayTheFlyPro {
    // ============ Enums ============

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

    /**
     * @notice Transaction types for unified event monitoring
     * @dev Used by backend services to filter and process different transaction types
     */
    enum TxType {
        NONE,                // 0: Reserved / Invalid
        PAYMENT,             // 1: User payment (pay/payToken)
        WITHDRAWAL,          // 2: User withdrawal with signature (withdraw/withdrawToken)
        ADMIN_WITHDRAWAL,    // 3: Admin withdraws from payment pool (multi-sig)
        POOL_DEPOSIT,        // 4: Admin deposits to withdrawal pool
        POOL_WITHDRAW,       // 5: Admin withdraws from withdrawal pool (multi-sig)
        EMERGENCY_WITHDRAW   // 6: Emergency withdrawal of all funds (multi-sig)
    }

    // ============ Structs ============

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

    struct TokenBalance {
        uint256 paymentBalance;
        uint256 withdrawalBalance;
    }

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

    // ============ Events ============

    /**
     * @notice Unified transaction event for backend monitoring
     * @dev Emitted for all fund-related transactions to simplify event listening
     * @param projectId Project identifier
     * @param token Token address (address(0) for native ETH/TRX)
     * @param account User/recipient address involved in the transaction
     * @param amount Transaction amount (net amount after fees for payments)
     * @param fee Fee amount (0 for non-payment transactions)
     * @param serialNo Serial number (empty for pool operations)
     * @param txType Transaction type enum
     */
    event Transaction(
        string projectId,
        address indexed token,
        address indexed account,
        uint256 amount,
        uint256 fee,
        string serialNo,
        TxType indexed txType
    );

    // Admin Events
    event SignerUpdated(address indexed oldSigner, address indexed newSigner, uint256 proposalId);
    event AdminAdded(address indexed admin, uint256 proposalId);
    event AdminRemoved(address indexed admin, uint256 proposalId);
    event ThresholdChanged(uint256 oldThreshold, uint256 newThreshold, uint256 proposalId);
    event ProjectPaused(uint256 proposalId);
    event ProjectUnpaused(uint256 proposalId);
    event ProjectNameUpdated(string oldName, string newName);

    // Proposal Events
    event ProposalCreated(
        uint256 indexed proposalId,
        OperationType opType,
        address indexed proposer,
        uint256 deadline
    );
    event ProposalConfirmed(uint256 indexed proposalId, address indexed admin);
    event ProposalRevoked(uint256 indexed proposalId, address indexed admin);
    event ProposalCancelled(uint256 indexed proposalId);
    event ProposalExecuted(uint256 indexed proposalId);

    // ============ Errors ============

    error NotAdmin();
    error NotFactory();
    error ProjectPausedError();
    error InvalidSignature();
    error ExpiredDeadline();
    error SerialNoUsed();
    error SerialNoTooLong();
    error InsufficientBalance();
    error InvalidAmount();
    error InvalidAddress();
    error InvalidThreshold();
    error MaxAdminsReached();
    error AdminAlreadyExists();
    error AdminNotFound();
    error ThresholdTooHigh();
    error ProposalNotFound();
    error ProposalExpired();
    error ProposalAlreadyExecuted();
    error ProposalCancelledError();
    error AlreadyConfirmed();
    error NotConfirmed();
    error NotProposer();
    error ThresholdNotReached();
    error InvalidProposalDuration();
    error NameTooLong();

    // ============ View Functions ============

    /**
     * @notice Get project information
     * @return ProjectInfo struct with all project details
     */
    function getProjectInfo() external view returns (ProjectInfo memory);

    /**
     * @notice Get balance for a single token
     * @param token Token address (address(0) for ETH)
     * @return TokenBalance with payment and withdrawal pool balances
     */
    function getBalance(address token) external view returns (TokenBalance memory);

    /**
     * @notice Get balances for multiple tokens
     * @param tokens Array of token addresses (address(0) for ETH)
     * @return Array of TokenBalance structs
     */
    function getBalancesBatch(address[] calldata tokens) external view returns (TokenBalance[] memory);

    /**
     * @notice Get admin list
     * @return Array of admin addresses
     */
    function getAdmins() external view returns (address[] memory);

    /**
     * @notice Get current threshold
     * @return Multi-sig confirmation threshold
     */
    function getThreshold() external view returns (uint256);

    /**
     * @notice Check if address is admin
     * @param account Address to check
     * @return True if address is admin
     */
    function isAdmin(address account) external view returns (bool);

    /**
     * @notice Get proposal details
     * @param proposalId Proposal ID
     * @return ProposalInfo struct with proposal details
     */
    function getProposal(uint256 proposalId) external view returns (ProposalInfo memory);

    /**
     * @notice Get total proposal count
     * @return Total number of proposals created
     */
    function getProposalCount() external view returns (uint256);

    /**
     * @notice Get proposals with pagination (newest first)
     * @param offset Starting index
     * @param limit Maximum number of proposals to return
     * @return proposals Array of ProposalInfo
     * @return total Total proposal count
     */
    function getProposalsPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (ProposalInfo[] memory proposals, uint256 total);

    /**
     * @notice Check if admin has confirmed a proposal
     * @param proposalId Proposal ID
     * @param admin Admin address
     * @return True if admin has confirmed
     */
    function hasConfirmed(uint256 proposalId, address admin) external view returns (bool);

    /**
     * @notice Check if payment serial number has been used
     * @param serialNo Serial number to check
     * @return True if used
     */
    function isPaymentSerialNoUsed(string calldata serialNo) external view returns (bool);

    /**
     * @notice Check if withdrawal serial number has been used
     * @param serialNo Serial number to check
     * @return True if used
     */
    function isWithdrawalSerialNoUsed(string calldata serialNo) external view returns (bool);

    // ============ Payment Functions ============

    /**
     * @notice Pay with signature verification (ETH)
     * @param serialNo Unique serial number
     * @param deadline Signature expiration timestamp
     * @param signature Signer's EIP-712 signature
     */
    function pay(
        string calldata serialNo,
        uint256 deadline,
        bytes calldata signature
    ) external payable;

    /**
     * @notice Pay with signature verification (ERC20)
     * @param token Token address
     * @param amount Amount to pay
     * @param serialNo Unique serial number
     * @param deadline Signature expiration timestamp
     * @param signature Signer's EIP-712 signature
     */
    function payToken(
        address token,
        uint256 amount,
        string calldata serialNo,
        uint256 deadline,
        bytes calldata signature
    ) external;

    /**
     * @notice Withdraw with signature verification (ETH)
     * @param amount Amount to withdraw
     * @param serialNo Unique serial number
     * @param deadline Signature expiration timestamp
     * @param signature Signer's EIP-712 signature
     */
    function withdraw(
        uint256 amount,
        string calldata serialNo,
        uint256 deadline,
        bytes calldata signature
    ) external;

    /**
     * @notice Withdraw with signature verification (ERC20)
     * @param token Token address
     * @param amount Amount to withdraw
     * @param serialNo Unique serial number
     * @param deadline Signature expiration timestamp
     * @param signature Signer's EIP-712 signature
     */
    function withdrawToken(
        address token,
        uint256 amount,
        string calldata serialNo,
        uint256 deadline,
        bytes calldata signature
    ) external;

    // ============ Admin Functions (No Multi-Sig) ============

    /**
     * @notice Update project name (any admin, no multi-sig)
     * @param newName New project name
     */
    function setName(string calldata newName) external;

    /**
     * @notice Deposit to withdrawal pool (any admin, no multi-sig)
     * @param token Token address (address(0) for ETH)
     * @param amount Amount to deposit (ignored for ETH, uses msg.value)
     */
    function depositToWithdrawalPool(address token, uint256 amount) external payable;

    // ============ Multi-Sig Proposal Functions ============

    /**
     * @notice Create a new proposal
     * @param opType Operation type
     * @param params ABI-encoded parameters
     * @param deadline Proposal expiration timestamp
     * @return proposalId The created proposal ID
     */
    function createProposal(
        OperationType opType,
        bytes calldata params,
        uint256 deadline
    ) external returns (uint256 proposalId);

    /**
     * @notice Confirm a proposal
     * @param proposalId Proposal ID to confirm
     */
    function confirmProposal(uint256 proposalId) external;

    /**
     * @notice Revoke confirmation from a proposal
     * @param proposalId Proposal ID
     */
    function revokeConfirmation(uint256 proposalId) external;

    /**
     * @notice Cancel a proposal (only proposer)
     * @param proposalId Proposal ID
     */
    function cancelProposal(uint256 proposalId) external;

    /**
     * @notice Execute a proposal that has reached threshold
     * @param proposalId Proposal ID
     */
    function executeProposal(uint256 proposalId) external;

    // ============ Initialization ============

    /**
     * @notice Initialize the project contract (called by factory)
     * @param projectId Unique project identifier
     * @param name Project display name
     * @param creator Address that created the project
     * @param admin Initial admin address
     * @param signer Address authorized to sign requests
     */
    function initialize(
        string calldata projectId,
        string calldata name,
        address creator,
        address admin,
        address signer
    ) external;
}

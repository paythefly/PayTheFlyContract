// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./libraries/TronSafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IPayTheFly.sol";

/**
 * @title PayTheFly
 * @notice Payment management contract for TRON blockchain
 * @dev UUPS upgradeable pattern with dual fund pool system
 */
contract PayTheFly is
    IPayTheFly,
    Initializable,
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    using TronSafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Events
    event PauseLevelChanged(PauseLevel oldLevel, PauseLevel newLevel);
    event FeeVaultChanged(address indexed oldVault, address indexed newVault);
    event FeeRateChanged(uint256 oldRate, uint256 newRate);
    event FeeCollected(
        string projectId,
        address indexed token,
        uint256 feeAmount,
        address indexed feeVault,
        string serialNo
    );
    event WithdrawalFeeChanged(uint256 oldFee, uint256 newFee);
    event WithdrawalFeeCollected(string projectId, uint256 feeAmount, address indexed feeVault);

    // Constants
    bytes32 private constant WITHDRAWAL_TYPEHASH =
        keccak256("WithdrawalRequest(address user,string projectId,address token,uint256 amount,string serialNo,uint256 deadline)");

    bytes32 private constant PAYMENT_TYPEHASH =
        keccak256("PaymentRequest(string projectId,address token,uint256 amount,string serialNo,uint256 deadline)");

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    // String length limits
    uint256 private constant MAX_PROJECT_ID_LENGTH = 128;
    uint256 private constant MAX_NAME_LENGTH = 256;
    uint256 private constant MAX_SERIAL_NO_LENGTH = 128;

    // Fee constants
    uint256 private constant FEE_DENOMINATOR = 10000;  // 10000 = 100%, so 30 = 0.3%
    uint256 private constant MAX_FEE_RATE = 1000;      // Max 10% fee rate

    // Deployment version (used to force new deployment)
    uint256 private constant _DEPLOYMENT_VERSION = 1;

    // Pause levels
    enum PauseLevel {
        NONE,        // 0 - Normal operation
        DEPOSITS,    // 1 - Pause deposits (pay, depositToWithdrawalPool)
        WITHDRAWALS, // 2 - Pause withdrawals (withdraw, adminWithdraw)
        FULL         // 3 - Complete pause
    }

    // State variables - WARNING: DO NOT change order! Storage layout must be preserved for upgrades
    // Slot 0
    PauseLevel public pauseLevel;                                   // Pause level
    // Slot 1-7: Mappings (storage slots calculated by keccak256)
    mapping(string => Project) private projects;                    // projectId => Project
    mapping(string => bool) private projectExists;                  // Check if project exists
    mapping(string => mapping(address => ProjectBalance)) private projectBalances; // projectId => token => balance
    mapping(string => mapping(string => bool)) private usedPaymentSerialNos;     // projectId => serialNo => used status for payments
    mapping(string => mapping(string => bool)) private usedWithdrawalSerialNos;  // projectId => serialNo => used status
    uint256 private withdrawalSerialNoCounter;                      // Counter for generating unique withdrawal serial numbers
    mapping(address => string[]) private creatorProjects;          // creator => list of projectIds (created by)
    // New variables added in v1.3.0 - MUST be at end to preserve storage layout
    uint256 public feeRate;                                         // Fee rate (30 = 0.3%)
    address public feeVault;                                        // Address to receive fees
    // New variable added in v1.4.0 - withdrawal fee in native token (TRX)
    uint256 public withdrawalFee;                                   // Withdrawal fee in TRX (sun units)

    // Modifiers
    modifier whenNotPaused() {
        require(pauseLevel == PauseLevel.NONE, "PayTheFly: paused");
        _;
    }

    modifier whenDepositsNotPaused() {
        require(pauseLevel != PauseLevel.DEPOSITS && pauseLevel != PauseLevel.FULL,
                "PayTheFly: deposits paused");
        _;
    }

    modifier whenWithdrawalsNotPaused() {
        require(pauseLevel != PauseLevel.WITHDRAWALS && pauseLevel != PauseLevel.FULL,
                "PayTheFly: withdrawals paused");
        _;
    }

    modifier projectActive(string calldata projectId) {
        require(projectExists[projectId], "PayTheFly: project does not exist");
        require(projects[projectId].active, "PayTheFly: project is not active");
        _;
    }

    modifier onlyProjectCreator(string calldata projectId) {
        require(projectExists[projectId], "PayTheFly: project does not exist");
        require(projects[projectId].creator == msg.sender, "PayTheFly: not project creator");
        _;
    }

    modifier validStringLength(string calldata str, uint256 maxLength) {
        uint256 length = bytes(str).length;
        require(length > 0 && length <= maxLength, "PayTheFly: invalid string length");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract
     */
    function initialize() public initializer {
        __ReentrancyGuard_init();
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        pauseLevel = PauseLevel.NONE;
    }

    /**
     * @dev Required by UUPSUpgradeable - only owner can upgrade
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @dev Calculate DOMAIN_SEPARATOR dynamically to handle chain forks
     * @notice Uses block.chainid which returns TRON's chain ID
     */
    function _domainSeparatorV4() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("PayTheFly")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /**
     * @dev Public getter for DOMAIN_SEPARATOR
     */
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @dev Generate a unique withdrawal serial number
     * @return serialNo Unique serial number string (format: W_{chainId}_{counter})
     * @notice Auto-generated serialNo is globally unique due to counter, no need to track in mapping
     */
    function _generateWithdrawalSerialNo() internal returns (string memory) {
        withdrawalSerialNoCounter++;
        return string(
            abi.encodePacked(
                "W_",
                _uint256ToString(block.chainid),
                "_",
                _uint256ToString(withdrawalSerialNoCounter)
            )
        );
    }

    /**
     * @dev Convert uint256 to string
     * @param value The uint256 value
     * @return The string representation
     */
    function _uint256ToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /**
     * @dev Add project to creator's project list
     * @param creator Creator address
     * @param projectId Project identifier
     */
    function _addProjectToCreator(address creator, string memory projectId) internal {
        creatorProjects[creator].push(projectId);
    }

    /**
     * @dev Create a new project
     * @param projectId Unique project identifier
     * @param name Project name
     * @param signer Authorized signer for withdrawal verification
     */
    function createProject(
        string calldata projectId,
        string calldata name,
        address signer
    ) external override whenNotPaused
        validStringLength(projectId, MAX_PROJECT_ID_LENGTH)
        validStringLength(name, MAX_NAME_LENGTH)
    {
        require(!projectExists[projectId], "PayTheFly: project already exists");
        require(signer != address(0), "PayTheFly: invalid signer");

        projects[projectId] = Project({
            projectId: projectId,
            name: name,
            creator: msg.sender,
            signer: signer,
            active: true
        });

        projectExists[projectId] = true;

        // Add project to creator's project list
        _addProjectToCreator(msg.sender, projectId);

        emit ProjectCreated(projectId, name, msg.sender, signer);
    }

    /**
     * @dev Update project information
     * @param projectId Project identifier
     * @param name New project name
     * @param signer New authorized signer
     */
    function updateProject(
        string calldata projectId,
        string calldata name,
        address signer
    ) external override whenNotPaused onlyProjectCreator(projectId)
        validStringLength(name, MAX_NAME_LENGTH)
    {
        require(signer != address(0), "PayTheFly: invalid signer");

        projects[projectId].name = name;
        projects[projectId].signer = signer;

        emit ProjectUpdated(projectId, name, signer);
    }

    /**
     * @dev Set project active status
     * @param projectId Project identifier
     * @param active New active status
     */
    function setProjectStatus(
        string calldata projectId,
        bool active
    ) external override onlyProjectCreator(projectId) {
        projects[projectId].active = active;
        emit ProjectStatusChanged(projectId, active);
    }

    /**
     * @dev Pay with TRX or TRC20 token using signed request (prevents parameter tampering)
     * @param request Payment request details
     * @param signature Off-chain signature from project's authorized signer
     * @notice Anyone can pay with a valid signature, signature ensures parameters cannot be tampered
     */
    function pay(
        PaymentRequest calldata request,
        bytes calldata signature
    ) external payable override nonReentrant whenDepositsNotPaused projectActive(request.projectId) {
        require(request.amount > 0, "PayTheFly: zero amount");
        require(request.deadline >= block.timestamp, "PayTheFly: expired");

        uint256 serialNoLength = bytes(request.serialNo).length;
        require(serialNoLength > 0 && serialNoLength <= MAX_SERIAL_NO_LENGTH,
                "PayTheFly: invalid serial no length");
        require(!usedPaymentSerialNos[request.projectId][request.serialNo],
                "PayTheFly: payment serial no already used");

        // Validate signature length
        require(signature.length == 65, "PayTheFly: invalid signature length");

        // Get project signer
        address projectSigner = projects[request.projectId].signer;
        require(projectSigner != address(0), "PayTheFly: invalid project signer");

        // Verify signature - ensures projectId, token, amount, serialNo, deadline cannot be tampered
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                keccak256(bytes(request.projectId)),
                request.token,
                request.amount,
                keccak256(bytes(request.serialNo)),
                request.deadline
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparatorV4(), structHash));
        // TRON TIP-191: wrap digest for TronLink signMessageV2 compatibility
        bytes32 tronDigest = keccak256(abi.encodePacked("\x19TRON Signed Message:\n32", digest));
        address recoveredSigner = ECDSA.recover(tronDigest, signature);
        require(recoveredSigner != address(0), "PayTheFly: invalid signature");
        require(recoveredSigner == projectSigner, "PayTheFly: signer mismatch");

        // Process payment
        uint256 paymentAmount;

        if (request.token == address(0)) {
            // TRX payment - must match the specified amount exactly
            require(msg.value == request.amount, "PayTheFly: incorrect TRX amount");
            paymentAmount = request.amount;
        } else {
            // Token payment
            require(msg.value == 0, "PayTheFly: TRX not accepted for token payment");

            // Record balance before transfer
            uint256 balanceBefore = IERC20(request.token).balanceOf(address(this));

            // Execute transfer
            IERC20(request.token).safeTransferFrom(msg.sender, address(this), request.amount);

            // Calculate actual received amount
            uint256 balanceAfter = IERC20(request.token).balanceOf(address(this));
            uint256 received = balanceAfter - balanceBefore;

            // Ensure received amount matches the specified amount exactly
            require(received == request.amount, "PayTheFly: incorrect token amount received");

            paymentAmount = request.amount;
        }

        usedPaymentSerialNos[request.projectId][request.serialNo] = true;

        // Calculate and collect fee
        uint256 feeAmount = 0;
        uint256 netAmount = paymentAmount;

        if (feeRate > 0 && feeVault != address(0)) {
            feeAmount = (paymentAmount * feeRate) / FEE_DENOMINATOR;
            netAmount = paymentAmount - feeAmount;

            // Transfer fee to feeVault
            if (feeAmount > 0) {
                if (request.token == address(0)) {
                    // TRX fee transfer
                    Address.sendValue(payable(feeVault), feeAmount);
                } else {
                    // Token fee transfer
                    IERC20(request.token).safeTransfer(feeVault, feeAmount);
                }
                emit FeeCollected(request.projectId, request.token, feeAmount, feeVault, request.serialNo);
            }
        }

        ProjectBalance storage balance = projectBalances[request.projectId][request.token];
        balance.paymentBalance += netAmount;

        emit Transaction(request.projectId, request.token, msg.sender, paymentAmount, feeAmount, request.serialNo, TxType.PAYMENT);
    }

    /**
     * @dev Pay with TRX or TRC20 token using signed request (prevents parameter tampering)
     * @param request Payment request details
     * @param signature Off-chain signature from project's authorized signer
     * @notice Anyone can pay with a valid signature, signature ensures parameters cannot be tampered
     */
    function payWithSign(
        PaymentRequest calldata request,
        bytes calldata signature
    ) external payable override nonReentrant whenDepositsNotPaused projectActive(request.projectId) {
        require(request.amount > 0, "PayTheFly: zero amount");
        require(request.deadline >= block.timestamp, "PayTheFly: expired");

        uint256 serialNoLength = bytes(request.serialNo).length;
        require(serialNoLength > 0 && serialNoLength <= MAX_SERIAL_NO_LENGTH,
                "PayTheFly: invalid serial no length");
        require(!usedPaymentSerialNos[request.projectId][request.serialNo],
                "PayTheFly: payment serial no already used");

        // Validate signature length
        require(signature.length == 65, "PayTheFly: invalid signature length");

        // Get project signer
        address projectSigner = projects[request.projectId].signer;
        require(projectSigner != address(0), "PayTheFly: invalid project signer");

        // Verify signature - ensures projectId, token, amount, serialNo, deadline cannot be tampered
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_TYPEHASH,
                keccak256(bytes(request.projectId)),
                request.token,
                request.amount,
                keccak256(bytes(request.serialNo)),
                request.deadline
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparatorV4(), structHash));
        // TRON TIP-191: wrap digest for TronLink signMessageV2 compatibility
        bytes32 tronDigest = keccak256(abi.encodePacked("\x19TRON Signed Message:\n32", digest));
        address recoveredSigner = ECDSA.recover(tronDigest, signature);
        require(recoveredSigner != address(0), "PayTheFly: invalid signature");
        require(recoveredSigner == projectSigner, "PayTheFly: signer mismatch");

        // Process payment
        uint256 paymentAmount;

        if (request.token == address(0)) {
            // TRX payment - must match the specified amount exactly
            require(msg.value == request.amount, "PayTheFly: incorrect TRX amount");
            paymentAmount = request.amount;
        } else {
            // Token payment
            require(msg.value == 0, "PayTheFly: TRX not accepted for token payment");

            // Record balance before transfer
            uint256 balanceBefore = IERC20(request.token).balanceOf(address(this));

            // Execute transfer
            IERC20(request.token).safeTransferFrom(msg.sender, address(this), request.amount);

            // Calculate actual received amount
            uint256 balanceAfter = IERC20(request.token).balanceOf(address(this));
            uint256 received = balanceAfter - balanceBefore;

            // Ensure received amount matches the specified amount exactly
            require(received == request.amount, "PayTheFly: incorrect token amount received");

            paymentAmount = request.amount;
        }

        usedPaymentSerialNos[request.projectId][request.serialNo] = true;

        // Calculate and collect fee
        uint256 feeAmount = 0;
        uint256 netAmount = paymentAmount;

        if (feeRate > 0 && feeVault != address(0)) {
            feeAmount = (paymentAmount * feeRate) / FEE_DENOMINATOR;
            netAmount = paymentAmount - feeAmount;

            // Transfer fee to feeVault
            if (feeAmount > 0) {
                if (request.token == address(0)) {
                    // TRX fee transfer
                    Address.sendValue(payable(feeVault), feeAmount);
                } else {
                    // Token fee transfer
                    IERC20(request.token).safeTransfer(feeVault, feeAmount);
                }
                emit FeeCollected(request.projectId, request.token, feeAmount, feeVault, request.serialNo);
            }
        }

        ProjectBalance storage balance = projectBalances[request.projectId][request.token];
        balance.paymentBalance += netAmount;

        emit Transaction(request.projectId, request.token, msg.sender, paymentAmount, feeAmount, request.serialNo, TxType.PAYMENT);
    }

    /**
     * @dev User withdraws funds with off-chain signature
     * @param request Withdrawal request details (user must be specified and match msg.sender)
     * @param signature Off-chain signature from project's authorized signer
     * @notice User must send withdrawalFee amount of TRX to cover the withdrawal fee
     */
    function withdraw(
        WithdrawalRequest calldata request,
        bytes calldata signature
    ) external payable override nonReentrant whenWithdrawalsNotPaused projectActive(request.projectId) {
        // User must be specified to prevent MEV front-running attacks
        require(request.user != address(0), "PayTheFly: user required");
        require(request.user == msg.sender, "PayTheFly: invalid user");
        require(request.amount > 0, "PayTheFly: zero amount");
        require(request.deadline >= block.timestamp, "PayTheFly: expired");

        // Verify withdrawal fee payment
        require(msg.value >= withdrawalFee, "PayTheFly: insufficient withdrawal fee");

        uint256 withdrawalSerialNoLength = bytes(request.serialNo).length;
        require(withdrawalSerialNoLength > 0 && withdrawalSerialNoLength <= MAX_SERIAL_NO_LENGTH,
                "PayTheFly: invalid withdrawal serial no length");
        require(!usedWithdrawalSerialNos[request.projectId][request.serialNo],
                "PayTheFly: withdrawal serial no already used");

        // Validate signature length
        require(signature.length == 65, "PayTheFly: invalid signature length");

        // Get project signer
        address projectSigner = projects[request.projectId].signer;
        require(projectSigner != address(0), "PayTheFly: invalid project signer");

        // Verify signature
        bytes32 structHash = keccak256(
            abi.encode(
                WITHDRAWAL_TYPEHASH,
                request.user,
                keccak256(bytes(request.projectId)),
                request.token,
                request.amount,
                keccak256(bytes(request.serialNo)),
                request.deadline
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparatorV4(), structHash));
        // TRON TIP-191: wrap digest for TronLink signMessageV2 compatibility
        bytes32 tronDigest = keccak256(abi.encodePacked("\x19TRON Signed Message:\n32", digest));
        address recoveredSigner = ECDSA.recover(tronDigest, signature);
        require(recoveredSigner != address(0), "PayTheFly: invalid signature");
        require(recoveredSigner == projectSigner, "PayTheFly: signer mismatch");

        // Mark withdrawal serial no as used
        usedWithdrawalSerialNos[request.projectId][request.serialNo] = true;

        // Check and update withdrawal pool balance
        ProjectBalance storage balance = projectBalances[request.projectId][request.token];
        require(balance.withdrawalBalance >= request.amount, "PayTheFly: insufficient withdrawal pool balance");

        balance.withdrawalBalance -= request.amount;

        // Transfer funds to the actual caller (msg.sender)
        if (request.token == address(0)) {
            // TRX transfer
            Address.sendValue(payable(msg.sender), request.amount);
        } else {
            // Token transfer
            IERC20(request.token).safeTransfer(msg.sender, request.amount);
        }

        // Transfer withdrawal fee to feeVault
        if (withdrawalFee > 0 && feeVault != address(0) && msg.value > 0) {
            Address.sendValue(payable(feeVault), msg.value);
            emit WithdrawalFeeCollected(request.projectId, msg.value, feeVault);
        }

        emit Transaction(request.projectId, request.token, msg.sender, request.amount, 0, request.serialNo, TxType.WITHDRAWAL);
    }

    /**
     * @dev Project creator withdraws payment funds from their project
     * @param projectId Project identifier
     * @param token Token address (address(0) for TRX)
     * @param amount Amount to withdraw
     * @param recipient Recipient address
     */
    function adminWithdraw(
        string calldata projectId,
        address token,
        uint256 amount,
        address recipient
    ) external override nonReentrant whenWithdrawalsNotPaused onlyProjectCreator(projectId) {
        require(amount > 0, "PayTheFly: zero amount");
        require(recipient != address(0), "PayTheFly: invalid recipient");

        ProjectBalance storage balance = projectBalances[projectId][token];
        require(balance.paymentBalance >= amount, "PayTheFly: insufficient payment balance");

        balance.paymentBalance -= amount;

        // Generate unique serial number
        string memory serialNo = _generateWithdrawalSerialNo();

        // Transfer funds
        if (token == address(0)) {
            // TRX transfer
            Address.sendValue(payable(recipient), amount);
        } else {
            // Token transfer
            IERC20(token).safeTransfer(recipient, amount);
        }

        emit Transaction(projectId, token, recipient, amount, 0, serialNo, TxType.ADMIN_WITHDRAWAL);
    }

    /**
     * @dev Project creator deposits funds to withdrawal pool for user withdrawals
     * @param projectId Project identifier
     * @param token Token address (address(0) for TRX)
     * @param amount Amount to deposit (must match msg.value for TRX, must match actual received amount for tokens)
     */
    function depositToWithdrawalPool(
        string calldata projectId,
        address token,
        uint256 amount
    ) external payable override nonReentrant whenDepositsNotPaused onlyProjectCreator(projectId) {
        uint256 depositAmount;

        if (token == address(0)) {
            // TRX deposit - must match the specified amount exactly
            require(amount > 0, "PayTheFly: zero amount");
            require(msg.value == amount, "PayTheFly: incorrect TRX amount");
            depositAmount = amount;
        } else {
            // Token deposit
            require(msg.value == 0, "PayTheFly: TRX not accepted for token deposit");
            require(amount > 0, "PayTheFly: zero amount");

            // Record balance before transfer
            uint256 balanceBefore = IERC20(token).balanceOf(address(this));

            // Execute transfer
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

            // Calculate actual received amount
            uint256 balanceAfter = IERC20(token).balanceOf(address(this));
            uint256 received = balanceAfter - balanceBefore;

            // Ensure received amount matches the specified amount exactly
            require(received == amount, "PayTheFly: incorrect token amount received");

            depositAmount = amount;
        }

        ProjectBalance storage balance = projectBalances[projectId][token];
        balance.withdrawalBalance += depositAmount;

        // Generate unique serial number
        string memory serialNo = _generateWithdrawalSerialNo();

        emit Transaction(projectId, token, msg.sender, depositAmount, 0, serialNo, TxType.POOL_DEPOSIT);
    }

    /**
     * @dev Project creator withdraws funds from withdrawal pool
     * @param projectId Project identifier
     * @param token Token address (address(0) for TRX)
     * @param amount Amount to withdraw
     * @param recipient Recipient address
     */
    function withdrawFromWithdrawalPool(
        string calldata projectId,
        address token,
        uint256 amount,
        address recipient
    ) external override nonReentrant whenWithdrawalsNotPaused onlyProjectCreator(projectId) {
        require(amount > 0, "PayTheFly: zero amount");
        require(recipient != address(0), "PayTheFly: invalid recipient");

        ProjectBalance storage balance = projectBalances[projectId][token];
        require(balance.withdrawalBalance >= amount, "PayTheFly: insufficient withdrawal pool balance");

        balance.withdrawalBalance -= amount;

        // Generate unique serial number
        string memory serialNo = _generateWithdrawalSerialNo();

        // Transfer funds
        if (token == address(0)) {
            // TRX transfer
            Address.sendValue(payable(recipient), amount);
        } else {
            // Token transfer
            IERC20(token).safeTransfer(recipient, amount);
        }

        emit Transaction(projectId, token, recipient, amount, 0, serialNo, TxType.POOL_WITHDRAW);
    }

    /**
     * @dev Set fee vault address (only owner)
     * @param newFeeVault New fee vault address
     */
    function setFeeVault(address newFeeVault) external onlyOwner {
        require(newFeeVault != address(0), "PayTheFly: invalid fee vault");
        address oldVault = feeVault;
        feeVault = newFeeVault;
        emit FeeVaultChanged(oldVault, newFeeVault);
    }

    /**
     * @dev Set fee rate (only owner)
     * @param newFeeRate New fee rate (30 = 0.3%, max 1000 = 10%)
     */
    function setFeeRate(uint256 newFeeRate) external onlyOwner {
        require(newFeeRate <= MAX_FEE_RATE, "PayTheFly: fee rate too high");
        uint256 oldRate = feeRate;
        feeRate = newFeeRate;
        emit FeeRateChanged(oldRate, newFeeRate);
    }

    /**
     * @dev Set withdrawal fee in native token (only owner)
     * @param newWithdrawalFee New withdrawal fee in TRX (sun units, 1 TRX = 1e6 sun)
     */
    function setWithdrawalFee(uint256 newWithdrawalFee) external onlyOwner {
        uint256 oldFee = withdrawalFee;
        withdrawalFee = newWithdrawalFee;
        emit WithdrawalFeeChanged(oldFee, newWithdrawalFee);
    }

    /**
     * @dev Set pause level (only owner)
     * @param level New pause level
     */
    function setPauseLevel(PauseLevel level) external onlyOwner {
        PauseLevel oldLevel = pauseLevel;
        pauseLevel = level;
        emit PauseLevelChanged(oldLevel, level);
    }

    /**
     * @dev Pause the contract (only owner) - Legacy function for backward compatibility
     */
    function pause() external override onlyOwner {
        require(pauseLevel != PauseLevel.FULL, "PayTheFly: already fully paused");
        PauseLevel oldLevel = pauseLevel;
        pauseLevel = PauseLevel.FULL;
        emit PauseLevelChanged(oldLevel, PauseLevel.FULL);
        emit Paused(msg.sender);
    }

    /**
     * @dev Unpause the contract (only owner) - Legacy function for backward compatibility
     */
    function unpause() external override onlyOwner {
        require(pauseLevel != PauseLevel.NONE, "PayTheFly: not paused");
        PauseLevel oldLevel = pauseLevel;
        pauseLevel = PauseLevel.NONE;
        emit PauseLevelChanged(oldLevel, PauseLevel.NONE);
        emit Unpaused(msg.sender);
    }

    /**
     * @dev Get project information
     * @param projectId Project identifier
     * @return Project information
     */
    function getProject(string calldata projectId) external view override returns (Project memory) {
        require(projectExists[projectId], "PayTheFly: project does not exist");
        return projects[projectId];
    }

    /**
     * @dev Get project balance for a specific token
     * @param projectId Project identifier
     * @param token Token address (address(0) for TRX)
     * @return ProjectBalance information
     */
    function getProjectBalance(
        string calldata projectId,
        address token
    ) external view override returns (ProjectBalance memory) {
        require(projectExists[projectId], "PayTheFly: project does not exist");
        return projectBalances[projectId][token];
    }

    /**
     * @dev Check if a payment serial number has been used for a project
     * @param projectId Project identifier
     * @param serialNo Payment serial number
     * @return Whether the serial number has been used
     */
    function isPaymentSerialNoUsed(
        string calldata projectId,
        string calldata serialNo
    ) external view override returns (bool) {
        return usedPaymentSerialNos[projectId][serialNo];
    }

    /**
     * @dev Check if a withdrawal serial number has been used for a project
     * @param projectId Project identifier
     * @param withdrawalSerialNo Withdrawal serial number
     * @return Whether the withdrawal serial number has been used
     */
    function isWithdrawalSerialNoUsed(
        string calldata projectId,
        string calldata withdrawalSerialNo
    ) external view override returns (bool) {
        return usedWithdrawalSerialNos[projectId][withdrawalSerialNo];
    }

    /**
     * @dev Check if a project exists
     * @param projectId Project identifier
     * @return Whether the project exists
     */
    function doesProjectExist(string calldata projectId) external view returns (bool) {
        return projectExists[projectId];
    }

    /**
     * @dev Get all projects created by a specific address
     * @param creator Creator address
     * @return Array of project IDs
     */
    function getCreatorProjects(address creator) external view returns (string[] memory) {
        return creatorProjects[creator];
    }

    /**
     * @dev Get projects created by a specific address with pagination
     * @param creator Creator address
     * @param offset Starting index
     * @param limit Maximum number of projects to return
     * @return projectIds Array of project IDs
     * @return total Total number of projects
     */
    function getCreatorProjectsPaginated(
        address creator,
        uint256 offset,
        uint256 limit
    ) external view returns (string[] memory projectIds, uint256 total) {
        total = creatorProjects[creator].length;

        if (offset >= total || limit == 0) {
            return (new string[](0), total);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 resultLength = end - offset;
        projectIds = new string[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            projectIds[i] = creatorProjects[creator][offset + i];
        }

        return (projectIds, total);
    }

    /**
     * @dev Get the number of projects created by a specific address
     * @param creator Creator address
     * @return Number of projects
     */
    function getCreatorProjectCount(address creator) external view returns (uint256) {
        return creatorProjects[creator].length;
    }

    /**
     * @dev Receive function to accept TRX
     */
    receive() external payable {
        revert("PayTheFly: use pay function");
    }

    /**
     * @dev Fallback function
     */
    fallback() external payable {
        revert("PayTheFly: use pay function");
    }
}

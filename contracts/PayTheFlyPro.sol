// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPayTheFlyPro} from "./interfaces/IPayTheFlyPro.sol";
import {IPayTheFlyProFactory} from "./interfaces/IPayTheFlyProFactory.sol";
import {DataTypes} from "./libraries/DataTypes.sol";
import {TypeHashes} from "./libraries/TypeHashes.sol";
import {Errors} from "./libraries/Errors.sol";
import {SafeERC20Universal} from "./libraries/SafeERC20Universal.sol";

/**
 * @title Project
 * @notice Project contract for payment management with multi-sig admin functionality
 * @dev Deployed as BeaconProxy, uses EIP-712 for signature verification
 */
contract PayTheFlyPro is IPayTheFlyPro, Initializable, EIP712Upgradeable, ReentrancyGuardUpgradeable {
    using ECDSA for bytes32;

    // ============ Storage ============

    /// @notice Factory contract address
    address private _factory;

    /// @notice Unique project identifier
    string private _projectId;

    /// @notice Project display name
    string private _name;

    /// @notice Address that created the project
    address private _creator;

    /// @notice Address authorized to sign payment/withdrawal requests
    address private _signer;

    /// @notice Whether the project is paused
    bool private _paused;

    /// @notice List of admin addresses
    address[] private _admins;

    /// @notice Mapping to check if address is admin
    mapping(address => bool) private _isAdmin;

    /// @notice Mapping of admin address to index in _admins array
    mapping(address => uint256) private _adminIndex;

    /// @notice Multi-sig confirmation threshold
    uint256 private _threshold;

    /// @notice Total number of proposals created
    uint256 private _proposalCount;

    /// @notice Count of pending proposals (not executed, not cancelled)
    uint256 private _pendingProposalCount;

    /// @notice Mapping of proposal ID to proposal data
    mapping(uint256 => DataTypes.Proposal) private _proposals;

    /// @notice Mapping of proposal ID => admin => has confirmed
    mapping(uint256 => mapping(address => bool)) private _confirmations;

    /// @notice Payment pool balances by token (address(0) for ETH)
    mapping(address => uint256) private _paymentBalances;

    /// @notice Withdrawal pool balances by token (address(0) for ETH)
    mapping(address => uint256) private _withdrawalBalances;

    /// @notice Used payment serial numbers
    mapping(string => bool) private _usedPaymentSerialNos;

    /// @notice Used withdrawal serial numbers
    mapping(string => bool) private _usedWithdrawalSerialNos;

    // ============ Modifiers ============

    modifier onlyAdmin() {
        if (!_isAdmin[msg.sender]) revert NotAdmin();
        _;
    }

    modifier onlyFactory() {
        if (msg.sender != _factory) revert NotFactory();
        _;
    }

    modifier whenNotPaused() {
        if (_paused) revert ProjectPausedError();
        _;
    }

    // ============ Constructor ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Initializer ============

    /**
     * @notice Initialize the project contract
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
    ) external initializer {
        __EIP712_init("PayTheFlyPro", "1");
        __ReentrancyGuard_init();

        _factory = msg.sender;
        _projectId = projectId;
        _name = name;
        _creator = creator;
        _signer = signer;
        _paused = false;
        _threshold = 1;

        // Add initial admin
        _admins.push(admin);
        _isAdmin[admin] = true;
        _adminIndex[admin] = 0;
    }

    // ============ View Functions ============

    /// @inheritdoc IPayTheFlyPro
    function getProjectInfo() external view override returns (ProjectInfo memory) {
        return ProjectInfo({
            projectId: _projectId,
            name: _name,
            creator: _creator,
            signer: _signer,
            paused: _paused,
            admins: _admins,
            threshold: _threshold,
            activeProposalCount: _pendingProposalCount
        });
    }

    /// @inheritdoc IPayTheFlyPro
    function getBalance(address token) external view override returns (TokenBalance memory) {
        return TokenBalance({
            paymentBalance: _paymentBalances[token],
            withdrawalBalance: _withdrawalBalances[token]
        });
    }

    /// @inheritdoc IPayTheFlyPro
    function getBalancesBatch(address[] calldata tokens) external view override returns (TokenBalance[] memory) {
        TokenBalance[] memory balances = new TokenBalance[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            balances[i] = TokenBalance({
                paymentBalance: _paymentBalances[tokens[i]],
                withdrawalBalance: _withdrawalBalances[tokens[i]]
            });
        }
        return balances;
    }

    /// @inheritdoc IPayTheFlyPro
    function getAdmins() external view override returns (address[] memory) {
        return _admins;
    }

    /// @inheritdoc IPayTheFlyPro
    function getThreshold() external view override returns (uint256) {
        return _threshold;
    }

    /// @inheritdoc IPayTheFlyPro
    function isAdmin(address account) external view override returns (bool) {
        return _isAdmin[account];
    }

    /// @inheritdoc IPayTheFlyPro
    function getProposal(uint256 proposalId) external view override returns (ProposalInfo memory) {
        DataTypes.Proposal storage p = _proposals[proposalId];
        if (p.id == 0 && proposalId != 0) revert ProposalNotFound();
        if (proposalId == 0 && p.proposer == address(0)) revert ProposalNotFound();

        return ProposalInfo({
            id: p.id,
            opType: OperationType(uint8(p.opType)),
            params: p.params,
            proposer: p.proposer,
            deadline: p.deadline,
            confirmCount: p.confirmCount,
            executed: p.executed,
            cancelled: p.cancelled,
            confirmedBy: _getConfirmedBy(proposalId)
        });
    }

    /// @inheritdoc IPayTheFlyPro
    function getProposalCount() external view override returns (uint256) {
        return _proposalCount;
    }

    /// @inheritdoc IPayTheFlyPro
    function getProposalsPaginated(
        uint256 offset,
        uint256 limit
    ) external view override returns (ProposalInfo[] memory proposals, uint256 total) {
        total = _proposalCount;

        if (offset >= total || limit == 0) {
            return (new ProposalInfo[](0), total);
        }

        // Calculate actual count to return (newest first, so reverse order)
        uint256 remaining = total - offset;
        uint256 count = remaining < limit ? remaining : limit;
        proposals = new ProposalInfo[](count);

        for (uint256 i = 0; i < count; i++) {
            // Newest first: proposalId = total - offset - i - 1
            uint256 proposalId = total - offset - i - 1;
            DataTypes.Proposal storage p = _proposals[proposalId];
            proposals[i] = ProposalInfo({
                id: p.id,
                opType: OperationType(uint8(p.opType)),
                params: p.params,
                proposer: p.proposer,
                deadline: p.deadline,
                confirmCount: p.confirmCount,
                executed: p.executed,
                cancelled: p.cancelled,
                confirmedBy: _getConfirmedBy(proposalId)
            });
        }
    }

    /// @inheritdoc IPayTheFlyPro
    function hasConfirmed(uint256 proposalId, address admin) external view override returns (bool) {
        return _confirmations[proposalId][admin];
    }

    /// @inheritdoc IPayTheFlyPro
    function isPaymentSerialNoUsed(string calldata serialNo) external view override returns (bool) {
        return _usedPaymentSerialNos[serialNo];
    }

    /// @inheritdoc IPayTheFlyPro
    function isWithdrawalSerialNoUsed(string calldata serialNo) external view override returns (bool) {
        return _usedWithdrawalSerialNos[serialNo];
    }

    // ============ Payment Functions ============

    /// @inheritdoc IPayTheFlyPro
    function pay(
        PaymentRequest calldata request,
        bytes calldata signature
    ) external payable override whenNotPaused nonReentrant {
        _validateSerialNo(request.serialNo);
        if (block.timestamp > request.deadline) revert ExpiredDeadline();
        if (request.amount == 0) revert InvalidAmount();

        // Verify signature first (before any transfers)
        // No payer binding - anyone can pay with valid signature (consistent with EulerPay)
        bytes32 structHash = keccak256(abi.encode(
            TypeHashes.PAYMENT_TYPEHASH,
            keccak256(bytes(_projectId)),
            request.token,
            request.amount,
            keccak256(bytes(request.serialNo)),
            request.deadline
        ));
        _verifySignature(structHash, signature);

        // Mark serial number as used
        _usedPaymentSerialNos[request.serialNo] = true;

        // Process payment
        if (request.token == address(0)) {
            // ETH payment - must match the specified amount exactly
            if (msg.value != request.amount) revert InvalidAmount();
        } else {
            // ERC20 payment - no ETH should be sent
            if (msg.value != 0) revert InvalidAmount();
            // Transfer tokens from sender
            SafeERC20Universal.safeTransferFrom(IERC20(request.token), msg.sender, address(this), request.amount);
        }

        // Calculate fee
        uint256 feeAmount = _calculateFee(request.amount);
        uint256 netAmount = request.amount - feeAmount;

        // Transfer fee to vault
        if (feeAmount > 0) {
            address vault = IPayTheFlyProFactory(_factory).feeVault();
            if (request.token == address(0)) {
                (bool success, ) = vault.call{value: feeAmount}("");
                if (!success) revert Errors.TransferFailed();
            } else {
                SafeERC20Universal.safeTransfer(IERC20(request.token), vault, feeAmount);
            }
        }

        // Add to payment balance
        _paymentBalances[request.token] += netAmount;

        emit PayTheFlyTransaction(_projectId, request.token, msg.sender, netAmount, feeAmount, request.serialNo, TxType.PAYMENT);
    }

    /// @inheritdoc IPayTheFlyPro
    function withdraw(
        WithdrawalRequest calldata request,
        bytes calldata signature
    ) external override whenNotPaused nonReentrant {
        // User must match msg.sender to prevent MEV front-running
        if (request.user != msg.sender) revert InvalidAddress();
        _validateSerialNo(request.serialNo);
        if (block.timestamp > request.deadline) revert ExpiredDeadline();
        if (request.amount == 0) revert InvalidAmount();

        // Verify signature (consistent with EulerPay format)
        bytes32 structHash = keccak256(abi.encode(
            TypeHashes.WITHDRAWAL_TYPEHASH,
            request.user,
            keccak256(bytes(_projectId)),
            request.token,
            request.amount,
            keccak256(bytes(request.serialNo)),
            request.deadline
        ));
        _verifySignature(structHash, signature);

        // Mark serial number as used
        _usedWithdrawalSerialNos[request.serialNo] = true;

        // Check and update balance
        if (_withdrawalBalances[request.token] < request.amount) revert InsufficientBalance();
        _withdrawalBalances[request.token] -= request.amount;

        // Transfer funds
        if (request.token == address(0)) {
            // ETH transfer
            (bool success, ) = msg.sender.call{value: request.amount}("");
            if (!success) revert Errors.TransferFailed();
        } else {
            // ERC20 transfer
            SafeERC20Universal.safeTransfer(IERC20(request.token), msg.sender, request.amount);
        }

        emit PayTheFlyTransaction(_projectId, request.token, msg.sender, request.amount, 0, request.serialNo, TxType.WITHDRAWAL);
    }

    // ============ Admin Functions (No Multi-Sig) ============

    /// @inheritdoc IPayTheFlyPro
    function setName(string calldata newName) external override onlyAdmin {
        if (bytes(newName).length == 0) revert Errors.NameEmpty();
        if (bytes(newName).length > DataTypes.MAX_NAME_LENGTH) revert NameTooLong();

        string memory oldName = _name;
        _name = newName;

        emit ProjectNameUpdated(oldName, newName);
    }

    /// @inheritdoc IPayTheFlyPro
    function depositToWithdrawalPool(address token, uint256 amount) external payable override onlyAdmin {
        if (token == address(0)) {
            // ETH deposit
            if (msg.value == 0) revert InvalidAmount();
            _withdrawalBalances[address(0)] += msg.value;
            emit AdminPoolOperation(_projectId, address(0), msg.sender, msg.value, 0, AdminPoolOpType.POOL_DEPOSIT);
        } else {
            // ERC20 deposit
            if (amount == 0) revert InvalidAmount();
            SafeERC20Universal.safeTransferFrom(IERC20(token), msg.sender, address(this), amount);
            _withdrawalBalances[token] += amount;
            emit AdminPoolOperation(_projectId, token, msg.sender, amount, 0, AdminPoolOpType.POOL_DEPOSIT);
        }
    }

    // ============ Multi-Sig Proposal Functions ============

    /// @inheritdoc IPayTheFlyPro
    function createProposal(
        OperationType opType,
        bytes calldata params,
        uint256 deadline
    ) external override onlyAdmin returns (uint256 proposalId) {
        // Validate deadline
        if (deadline < block.timestamp + DataTypes.MIN_PROPOSAL_DURATION) revert InvalidProposalDuration();
        if (deadline > block.timestamp + DataTypes.MAX_PROPOSAL_DURATION) revert InvalidProposalDuration();

        proposalId = _proposalCount++;
        _pendingProposalCount++;

        _proposals[proposalId] = DataTypes.Proposal({
            id: proposalId,
            opType: DataTypes.OperationType(uint8(opType)),
            params: params,
            proposer: msg.sender,
            deadline: deadline,
            confirmCount: 1, // Creator auto-confirms
            executed: false,
            cancelled: false
        });

        _confirmations[proposalId][msg.sender] = true;

        emit ProposalCreated(proposalId, opType, msg.sender, deadline);
        emit ProposalConfirmed(proposalId, msg.sender);
    }

    /// @inheritdoc IPayTheFlyPro
    function confirmProposal(uint256 proposalId) external override onlyAdmin {
        DataTypes.Proposal storage p = _proposals[proposalId];

        if (p.proposer == address(0)) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.cancelled) revert ProposalCancelledError();
        if (block.timestamp > p.deadline) revert ProposalExpired();
        if (_confirmations[proposalId][msg.sender]) revert AlreadyConfirmed();

        _confirmations[proposalId][msg.sender] = true;
        p.confirmCount++;

        emit ProposalConfirmed(proposalId, msg.sender);
    }

    /// @inheritdoc IPayTheFlyPro
    function revokeConfirmation(uint256 proposalId) external override onlyAdmin {
        DataTypes.Proposal storage p = _proposals[proposalId];

        if (p.proposer == address(0)) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.cancelled) revert ProposalCancelledError();
        if (!_confirmations[proposalId][msg.sender]) revert NotConfirmed();

        _confirmations[proposalId][msg.sender] = false;
        p.confirmCount--;

        emit ProposalRevoked(proposalId, msg.sender);
    }

    /// @inheritdoc IPayTheFlyPro
    function cancelProposal(uint256 proposalId) external override onlyAdmin {
        DataTypes.Proposal storage p = _proposals[proposalId];

        if (p.proposer == address(0)) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.cancelled) revert ProposalCancelledError();
        if (p.proposer != msg.sender) revert NotProposer();

        p.cancelled = true;
        _pendingProposalCount--;

        emit ProposalCancelled(proposalId);
    }

    /// @inheritdoc IPayTheFlyPro
    function executeProposal(uint256 proposalId) external override onlyAdmin nonReentrant {
        DataTypes.Proposal storage p = _proposals[proposalId];

        if (p.proposer == address(0)) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.cancelled) revert ProposalCancelledError();
        if (block.timestamp > p.deadline) revert ProposalExpired();
        if (p.confirmCount < _threshold) revert ThresholdNotReached();

        p.executed = true;
        _pendingProposalCount--;

        _executeOperation(proposalId, p.opType, p.params);

        emit ProposalExecuted(proposalId);
    }

    // ============ Internal Functions ============

    /// @dev Validates serial number format and uniqueness
    function _validateSerialNo(string calldata serialNo) internal view {
        if (bytes(serialNo).length == 0) revert Errors.SerialNoEmpty();
        if (bytes(serialNo).length > DataTypes.MAX_SERIAL_NO_LENGTH) revert SerialNoTooLong();
        if (_usedPaymentSerialNos[serialNo] || _usedWithdrawalSerialNos[serialNo]) revert SerialNoUsed();
    }

    /// @dev Verifies EIP-712 signature against the signer
    function _verifySignature(bytes32 structHash, bytes calldata signature) internal view {
        bytes32 hash = _hashTypedDataV4(structHash);
        address recoveredSigner = hash.recover(signature);
        if (recoveredSigner != _signer) revert InvalidSignature();
    }

    /// @dev Calculates fee amount based on factory fee rate
    function _calculateFee(uint256 amount) internal view returns (uint256) {
        uint256 rate = IPayTheFlyProFactory(_factory).feeRate();
        return (amount * rate) / DataTypes.BASIS_POINTS;
    }

    /// @dev Returns list of admins who confirmed a proposal
    function _getConfirmedBy(uint256 proposalId) internal view returns (address[] memory) {
        DataTypes.Proposal storage p = _proposals[proposalId];
        address[] memory confirmed = new address[](p.confirmCount);
        uint256 idx = 0;

        for (uint256 i = 0; i < _admins.length && idx < p.confirmCount; i++) {
            if (_confirmations[proposalId][_admins[i]]) {
                confirmed[idx++] = _admins[i];
            }
        }

        return confirmed;
    }

    /// @dev Routes proposal execution to the appropriate handler
    function _executeOperation(
        uint256 proposalId,
        DataTypes.OperationType opType,
        bytes memory params
    ) internal {
        if (opType == DataTypes.OperationType.SetSigner) {
            _executeSetSigner(proposalId, params);
        } else if (opType == DataTypes.OperationType.AddAdmin) {
            _executeAddAdmin(proposalId, params);
        } else if (opType == DataTypes.OperationType.RemoveAdmin) {
            _executeRemoveAdmin(proposalId, params);
        } else if (opType == DataTypes.OperationType.ChangeThreshold) {
            _executeChangeThreshold(proposalId, params);
        } else if (opType == DataTypes.OperationType.AdminWithdraw) {
            _executeAdminWithdraw(proposalId, params);
        } else if (opType == DataTypes.OperationType.WithdrawFromPool) {
            _executeWithdrawFromPool(proposalId, params);
        } else if (opType == DataTypes.OperationType.Pause) {
            _executePause(proposalId);
        } else if (opType == DataTypes.OperationType.Unpause) {
            _executeUnpause(proposalId);
        } else if (opType == DataTypes.OperationType.EmergencyWithdraw) {
            _executeEmergencyWithdraw(proposalId, params);
        } else {
            revert Errors.InvalidOperationType();
        }
    }

    /// @dev Executes SetSigner proposal
    function _executeSetSigner(uint256 proposalId, bytes memory params) internal {
        address newSigner = abi.decode(params, (address));
        if (newSigner == address(0)) revert InvalidAddress();

        address oldSigner = _signer;
        _signer = newSigner;

        emit SignerUpdated(oldSigner, newSigner, proposalId);
    }

    /// @dev Executes AddAdmin proposal
    function _executeAddAdmin(uint256 proposalId, bytes memory params) internal {
        address newAdmin = abi.decode(params, (address));
        if (newAdmin == address(0)) revert InvalidAddress();
        if (_isAdmin[newAdmin]) revert AdminAlreadyExists();
        if (_admins.length >= DataTypes.MAX_ADMINS) revert MaxAdminsReached();

        _admins.push(newAdmin);
        _isAdmin[newAdmin] = true;
        _adminIndex[newAdmin] = _admins.length - 1;

        emit AdminAdded(newAdmin, proposalId);
    }

    /// @dev Executes RemoveAdmin proposal
    function _executeRemoveAdmin(uint256 proposalId, bytes memory params) internal {
        address admin = abi.decode(params, (address));
        if (!_isAdmin[admin]) revert AdminNotFound();
        if (_admins.length <= _threshold) revert ThresholdTooHigh();

        // Swap with last element and pop
        uint256 index = _adminIndex[admin];
        uint256 lastIndex = _admins.length - 1;

        if (index != lastIndex) {
            address lastAdmin = _admins[lastIndex];
            _admins[index] = lastAdmin;
            _adminIndex[lastAdmin] = index;
        }

        _admins.pop();
        delete _isAdmin[admin];
        delete _adminIndex[admin];

        emit AdminRemoved(admin, proposalId);
    }

    /// @dev Executes ChangeThreshold proposal
    function _executeChangeThreshold(uint256 proposalId, bytes memory params) internal {
        uint256 newThreshold = abi.decode(params, (uint256));
        if (newThreshold == 0 || newThreshold > _admins.length) revert InvalidThreshold();

        uint256 oldThreshold = _threshold;
        _threshold = newThreshold;

        emit ThresholdChanged(oldThreshold, newThreshold, proposalId);
    }

    /// @dev Executes AdminWithdraw proposal (withdraw from payment pool)
    function _executeAdminWithdraw(uint256 proposalId, bytes memory params) internal {
        (address token, uint256 amount, address recipient) = abi.decode(params, (address, uint256, address));
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (_paymentBalances[token] < amount) revert InsufficientBalance();

        _paymentBalances[token] -= amount;

        if (token == address(0)) {
            (bool success, ) = recipient.call{value: amount}("");
            if (!success) revert Errors.TransferFailed();
        } else {
            SafeERC20Universal.safeTransfer(IERC20(token), recipient, amount);
        }

        emit AdminPoolOperation(_projectId, token, recipient, amount, proposalId, AdminPoolOpType.ADMIN_WITHDRAWAL);
    }

    /// @dev Executes WithdrawFromPool proposal (withdraw from withdrawal pool)
    function _executeWithdrawFromPool(uint256 proposalId, bytes memory params) internal {
        (address token, uint256 amount, address recipient) = abi.decode(params, (address, uint256, address));
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (_withdrawalBalances[token] < amount) revert InsufficientBalance();

        _withdrawalBalances[token] -= amount;

        if (token == address(0)) {
            (bool success, ) = recipient.call{value: amount}("");
            if (!success) revert Errors.TransferFailed();
        } else {
            SafeERC20Universal.safeTransfer(IERC20(token), recipient, amount);
        }

        emit AdminPoolOperation(_projectId, token, recipient, amount, proposalId, AdminPoolOpType.POOL_WITHDRAW);
    }

    /// @dev Executes Pause proposal
    function _executePause(uint256 proposalId) internal {
        _paused = true;
        emit ProjectPaused(proposalId);
    }

    /// @dev Executes Unpause proposal
    function _executeUnpause(uint256 proposalId) internal {
        _paused = false;
        emit ProjectUnpaused(proposalId);
    }

    /// @dev Executes EmergencyWithdraw proposal (withdraw all funds)
    function _executeEmergencyWithdraw(uint256 proposalId, bytes memory params) internal {
        (address token, address recipient) = abi.decode(params, (address, address));
        if (recipient == address(0)) revert InvalidAddress();

        uint256 totalAmount = _paymentBalances[token] + _withdrawalBalances[token];
        if (totalAmount == 0) revert InsufficientBalance();

        _paymentBalances[token] = 0;
        _withdrawalBalances[token] = 0;

        if (token == address(0)) {
            (bool success, ) = recipient.call{value: totalAmount}("");
            if (!success) revert Errors.TransferFailed();
        } else {
            SafeERC20Universal.safeTransfer(IERC20(token), recipient, totalAmount);
        }

        emit AdminPoolOperation(_projectId, token, recipient, totalAmount, proposalId, AdminPoolOpType.EMERGENCY_WITHDRAW);
    }

    // ============ Receive ETH ============

    /**
     * @notice Reject direct ETH transfers to prevent unaccounted funds
     * @dev Use pay() for payments or depositToWithdrawalPool() for admin deposits
     */
    receive() external payable {
        revert Errors.DirectTransferNotAllowed();
    }

    /**
     * @notice Reject any calls with data to prevent unaccounted funds
     * @dev Use pay() for payments or depositToWithdrawalPool() for admin deposits
     */
    fallback() external payable {
        revert Errors.DirectTransferNotAllowed();
    }
}

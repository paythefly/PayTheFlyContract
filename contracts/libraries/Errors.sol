// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Errors
 * @notice Shared custom errors for the Project Payment System
 */
library Errors {
    // ============ Factory Errors ============
    error ProjectIdEmpty();
    error ProjectIdTooLong();
    error ProjectAlreadyExists();
    error InvalidAdminAddress();
    error InvalidFeeVault();
    error FeeRateTooHigh();
    error InvalidSignerAddress();
    error InvalidImplementation();

    // ============ Project Errors ============
    error NotAdmin();
    error NotFactory();
    error ProjectPausedError();
    error InvalidSignature();
    error ExpiredDeadline();
    error SerialNoUsed();
    error SerialNoTooLong();
    error SerialNoEmpty();
    error InsufficientBalance();
    error InvalidAmount();
    error InvalidAddress();
    error InvalidThreshold();
    error MaxAdminsReached();
    error AdminAlreadyExists();
    error AdminNotFound();
    error ThresholdTooHigh();
    error NameEmpty();
    error NameTooLong();
    error TransferFailed();
    error DirectTransferNotAllowed();

    // ============ Proposal Errors ============
    error ProposalNotFound();
    error ProposalExpired();
    error ProposalAlreadyExecuted();
    error ProposalCancelledError();
    error AlreadyConfirmed();
    error NotConfirmed();
    error NotProposer();
    error ThresholdNotReached();
    error InvalidProposalDuration();
    error InvalidOperationType();
}

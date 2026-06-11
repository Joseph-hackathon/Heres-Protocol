//! Program error codes.

use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized: signer is neither the owner nor the heartbeat authority")]
    Unauthorized,
    #[msg("Capsule is not active")]
    CapsuleInactive,
    #[msg("Capsule is active")]
    CapsuleActive,
    #[msg("Capsule has not been executed")]
    CapsuleNotExecuted,
    #[msg("Inactivity period has not been met")]
    InactivityPeriodNotMet,
    #[msg("Inactivity period must be greater than zero")]
    InvalidInactivityPeriod,
    #[msg("Grace period has not elapsed since execution")]
    GracePeriodNotElapsed,
    #[msg("Invalid fee config or fee recipient")]
    InvalidFeeConfig,
    #[msg("Invalid token account provided")]
    InvalidTokenAccount,
    #[msg("Invalid beneficiary address")]
    InvalidBeneficiaryAddress,
    #[msg("Too many beneficiaries (max 8)")]
    TooManyBeneficiaries,
    #[msg("Beneficiary shares must sum to 10000 bps (100%)")]
    InvalidShareSum,
    #[msg("No beneficiaries set on the capsule")]
    NoBeneficiaries,
    #[msg("Invalid instruction data for crank")]
    InvalidInstructionData,
    #[msg("Vault is empty; nothing to distribute or recover")]
    NothingToDistribute,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
}

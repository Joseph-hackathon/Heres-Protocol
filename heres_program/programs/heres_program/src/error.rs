//! Program error codes.

use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized: Only the owner can perform this action")]
    Unauthorized,
    #[msg("Capsule is not active")]
    CapsuleInactive,
    #[msg("Capsule is active")]
    CapsuleActive,
    #[msg("Capsule has not been executed")]
    CapsuleNotExecuted,
    #[msg("Inactivity period has not been met")]
    InactivityPeriodNotMet,
    #[msg("Invalid intent data format")]
    InvalidIntentData,
    #[msg("Invalid beneficiary address")]
    InvalidBeneficiaryAddress,
    #[msg("Invalid instruction data for crank")]
    InvalidInstructionData,
    #[msg("Invalid or stale price feed")]
    InvalidPriceFeed,
    #[msg("Invalid fee config or fee recipient")]
    InvalidFeeConfig,
    #[msg("Invalid token account provided")]
    InvalidTokenAccount,
    #[msg("Unsupported beneficiary chain")]
    UnsupportedBeneficiaryChain,
    #[msg("Invalid CCIP account set provided")]
    InvalidCcipAccounts,
    #[msg("CCIP transfer already sent for this beneficiary")]
    CcipAlreadySent,
    #[msg("Private distribution is not enabled for this capsule")]
    PrivateDistributionNotEnabled,
    #[msg("Private distribution already completed")]
    PrivateDistributionAlreadyDone,
    #[msg("Assets already distributed for this capsule")]
    AlreadyDistributed,
    #[msg("Distributor is not the authorized protocol distributor")]
    InvalidDistributor,
    #[msg("Inactivity period must be greater than zero")]
    InvalidInactivityPeriod,
}

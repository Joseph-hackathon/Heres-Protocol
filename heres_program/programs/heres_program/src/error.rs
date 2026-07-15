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
    #[msg("Target date must be in the future")]
    InvalidTargetDate,
    #[msg("Reserved error code")]
    ReservedLegacyError,
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
    #[msg("Too many NFT assignments (max 8)")]
    TooManyNftAssignments,
    #[msg("NFT assignment mint or recipient is invalid")]
    InvalidNftAssignment,
    #[msg("Duplicate NFT mint assignment")]
    DuplicateNftAssignment,
    #[msg("NFT assignment was not found for this mint and recipient")]
    NftAssignmentNotFound,
    #[msg("Mint is not a supported standard NFT (expected supply 1 and decimals 0)")]
    InvalidNftMint,
    #[msg("NFT has an explicit recipient and must use the NFT distribution instruction")]
    NftRequiresAssignedDistribution,
    #[msg("Token-2022 mint uses an extension that Heres cannot settle safely")]
    UnsupportedTokenExtension,
    #[msg("Inheritance configuration is already sealed")]
    InheritanceAlreadySealed,
    #[msg("Inheritance configuration must be sealed before activation")]
    InheritanceNotSealed,
    #[msg("Inheritance configuration does not match the sealed commitment")]
    InvalidConfigurationCommitment,
    #[msg("Capsule is not an unarmed draft")]
    CapsuleNotDraft,
    #[msg("Vault still contains funded assets")]
    VaultNotEmpty,
    #[msg("Vault asset manifest is full or inconsistent")]
    InvalidAssetManifest,
}

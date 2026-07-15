//! Anchor events emitted by the program.

use anchor_lang::prelude::*;

#[event]
pub struct IntentExecuted {
    pub capsule: Pubkey,
    pub owner: Pubkey,
    pub executed_at: i64,
}

#[event]
pub struct AssetsDistributed {
    pub capsule: Pubkey,
    pub owner: Pubkey,
    /// `Pubkey::default()` for native SOL, otherwise the SPL mint distributed in this call.
    pub mint: Pubkey,
    pub total: u64,
}

#[event]
pub struct NftDistributed {
    pub capsule: Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub recipient: Pubkey,
}

#[event]
pub struct CapsuleFinalized {
    pub capsule: Pubkey,
    pub owner: Pubkey,
    pub fee_recipient: Pubkey,
    pub rent_reclaimed: u64,
}

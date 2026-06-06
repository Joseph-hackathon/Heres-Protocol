//! The core inheritance capsule account.
//! Seeds = ["intent_capsule", owner].

use anchor_lang::prelude::*;

#[account]
pub struct IntentCapsule {
    pub owner: Pubkey,
    pub inactivity_period: i64,    // seconds
    pub last_activity: i64,        // unix timestamp
    pub intent_data: Vec<u8>,      // encoded intent instructions
    pub is_active: bool,
    pub executed_at: Option<i64>,
    pub bump: u8,
    pub vault_bump: u8,            // for invoke_signed when transferring from vault
    pub mint: Pubkey,
    pub retry_count: u64,          // Fail-safe: track TEE/execution retries
    pub ccip_sent_bitmap: u16,     // Bitmap tracking which beneficiary indexes have had CCIP sent (max 16)
    pub private_distributed: bool, // true after prepare_private_distribution completes (replay guard)
}

impl IntentCapsule {
    pub const LEN: usize = 32 + // owner
        8 +                      // inactivity_period
        8 +                      // last_activity
        4 + 1024 +               // intent_data (max 1KB)
        1 +                      // is_active
        1 + 8 +                  // executed_at (Option<i64>)
        1 +                      // bump
        1 +                      // vault_bump
        32 +                     // mint
        8 +                      // retry_count
        2 +                      // ccip_sent_bitmap
        1;                       // private_distributed
}

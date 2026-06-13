//! The Switch: per-wallet liveness only (Workstream A split).
//!
//! Holds the inactivity clock + the heartbeat authority. The private beneficiary list lives in a
//! SEPARATE account (`BeneficiarySet`) so the Switch can be delegated to a *regular* ER - making
//! heartbeats gasless AND token-free - while only the beneficiary list sits in the TEE. The Switch
//! carries no funds and no beneficiaries; the base-layer Vault's token accounts are the asset
//! manifest. Seeds = ["intent_capsule", owner].

use anchor_lang::prelude::*;

#[account]
pub struct IntentCapsule {
    pub owner: Pubkey,
    pub inactivity_period: i64, // seconds of silence before the switch may fire
    pub last_activity: i64,     // unix timestamp of the last proof-of-life
    pub is_active: bool,
    pub executed_at: Option<i64>, // set when the switch fires; doubles as the grace-window anchor
    pub bump: u8,
    pub vault_bump: u8,
    pub beneficiaries_bump: u8,      // bump of the paired BeneficiarySet PDA (TEE), to derive/sign for it
    pub heartbeat_authority: Pubkey, // off-chain relayer allowed to bump last_activity (regular ER)
    pub version: u8,
    pub target_date: Option<i64>, // absolute unix ts; fires regardless of activity once reached (None = inactivity-only)
    pub reserved: [u8; 55], // future liveness fields (per-capsule grace, HA validator) - no resize
}

impl IntentCapsule {
    /// On-chain layout version. Bump when the struct changes so future code can branch on it.
    pub const CURRENT_VERSION: u8 = 1;

    pub const LEN: usize = 32 + // owner
        8 +                      // inactivity_period
        8 +                      // last_activity
        1 +                      // is_active
        1 + 8 +                  // executed_at (Option<i64>)
        1 +                      // bump
        1 +                      // vault_bump
        1 +                      // beneficiaries_bump
        32 +                     // heartbeat_authority
        1 +                      // version
        1 + 8 +                  // target_date (Option<i64>)
        55; // reserved (was 64; 9 bytes moved to target_date - total LEN unchanged, so deployed accounts stay valid)
}

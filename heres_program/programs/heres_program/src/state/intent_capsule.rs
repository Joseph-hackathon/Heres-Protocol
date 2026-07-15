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
    pub executed_at: Option<i64>, // set when the switch fires
    pub bump: u8,
    pub vault_bump: u8,
    pub beneficiaries_bump: u8, // bump of the paired BeneficiarySet PDA (TEE), to derive/sign for it
    pub heartbeat_authority: Pubkey, // off-chain relayer allowed to bump last_activity (regular ER)
    pub version: u8,
    pub target_date: Option<i64>, // absolute unix ts; fires regardless of activity once reached (None = inactivity-only)
    pub reserved: [u8; 55],       // bytes 0..32 hold the sealed inheritance commitment in v2+
}

impl IntentCapsule {
    /// On-chain layout version. Bump when the struct changes so future code can branch on it.
    pub const CURRENT_VERSION: u8 = 2;
    pub const SEALED_CONFIG_VERSION: u8 = 2;
    const CONFIG_HASH_END: usize = 32;

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

    pub fn requires_config_commitment(&self) -> bool {
        self.version >= Self::SEALED_CONFIG_VERSION
    }

    pub fn config_commitment(&self) -> [u8; 32] {
        let mut commitment = [0u8; 32];
        commitment.copy_from_slice(&self.reserved[..Self::CONFIG_HASH_END]);
        commitment
    }

    pub fn has_config_commitment(&self) -> bool {
        self.config_commitment() != [0u8; 32]
    }

    pub fn set_config_commitment(&mut self, commitment: [u8; 32]) {
        self.reserved[..Self::CONFIG_HASH_END].copy_from_slice(&commitment);
    }

    pub fn clear_config_commitment(&mut self) {
        self.reserved[..Self::CONFIG_HASH_END].fill(0);
    }
}

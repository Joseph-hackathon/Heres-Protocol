//! The Switch: per-wallet liveness + private beneficiary list.
//!
//! Under Model A this is the ONLY delegated account (lives in the PER/TEE from creation), so the
//! beneficiary list stays inside the enclave while the owner is alive (Tier-1 privacy). It carries
//! no funds and no per-asset state - the base-layer Vault's token accounts are the asset manifest.
//! Seeds = ["intent_capsule", owner].

use anchor_lang::prelude::*;

use crate::constants::MAX_BENEFICIARIES;

/// One inheritance beneficiary and its share of every distributed asset, in basis points.
/// Shares across the list must sum to `BPS_DENOMINATOR` (10000 = 100%).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq)]
pub struct Beneficiary {
    pub pubkey: Pubkey,
    pub share_bps: u16,
}

impl Beneficiary {
    pub const LEN: usize = 32 + 2;
}

#[account]
pub struct IntentCapsule {
    pub owner: Pubkey,
    pub inactivity_period: i64, // seconds of silence before the switch may fire
    pub last_activity: i64,     // unix timestamp of the last proof-of-life
    pub is_active: bool,
    pub executed_at: Option<i64>, // set when the switch fires; doubles as the grace-window anchor
    pub bump: u8,
    pub vault_bump: u8,
    pub heartbeat_authority: Pubkey, // off-chain relayer allowed to bump last_activity
    pub beneficiaries: Vec<Beneficiary>, // PRIVATE while delegated; set via update_intent on the PER
}

impl IntentCapsule {
    pub const LEN: usize = 32 + // owner
        8 +                      // inactivity_period
        8 +                      // last_activity
        1 +                      // is_active
        1 + 8 +                  // executed_at (Option<i64>)
        1 +                      // bump
        1 +                      // vault_bump
        32 +                     // heartbeat_authority
        4 + MAX_BENEFICIARIES * Beneficiary::LEN; // beneficiaries (Vec len prefix + capped elems)
}

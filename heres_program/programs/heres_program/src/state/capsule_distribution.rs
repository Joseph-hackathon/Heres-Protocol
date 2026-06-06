//! Distribution-state PDA for capsules using private distribution via PER.
//! Seeds = ["distribution", capsule].

use anchor_lang::prelude::*;

#[account]
pub struct CapsuleDistribution {
    pub capsule: Pubkey,              // capsule this distribution belongs to
    pub is_private_distributed: bool, // true after prepare_private_distribution completes
    pub bump: u8,
}

impl CapsuleDistribution {
    pub const LEN: usize = 32 + 1 + 1;
}

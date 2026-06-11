//! Global platform fee configuration (singleton PDA, seeds = ["fee_config"]).
//! Lean model: creation fee only - the per-distribution execution-bps skim was dropped (redesign D3).

use anchor_lang::prelude::*;

#[account]
pub struct FeeConfig {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub creation_fee_lamports: u64,
}

impl FeeConfig {
    pub const LEN: usize = 32 + 32 + 8;
}

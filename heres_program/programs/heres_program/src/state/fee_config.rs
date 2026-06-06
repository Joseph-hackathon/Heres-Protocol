//! Global platform fee configuration (singleton PDA, seeds = ["fee_config"]).

use anchor_lang::prelude::*;

#[account]
pub struct FeeConfig {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub creation_fee_lamports: u64,
    pub execution_fee_bps: u16, // basis points, 10000 = 100%
}

impl FeeConfig {
    pub const LEN: usize = 32 + 32 + 8 + 2;
}

//! Dedicated relayer/distributor config (singleton PDA, seeds = ["distributor_config"]).
//!
//! Kept separate from FeeConfig on purpose: the relayer identity must be admin-settable, but
//! growing the already-initialized FeeConfig singleton would break every `Account<FeeConfig>`
//! read on an in-place upgrade (the old account is too small to deserialize the new layout).
//! A dedicated PDA is created fresh and is equally admin-controlled (gated on fee_config.authority).
//!
//! This pins the EOA that `prepare_private_distribution` may route vault funds to before the
//! off-chain MagicBlock Private Payments leg fans them out (Option B relayer-crank leg).

use anchor_lang::prelude::*;

#[account]
pub struct DistributorConfig {
    pub distributor: Pubkey,
}

impl DistributorConfig {
    pub const LEN: usize = 32;
}

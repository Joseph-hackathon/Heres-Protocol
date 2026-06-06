//! Set (or initialize) the protocol relayer/distributor for Option B private distribution.
//!
//! Admin-only: gated on `fee_config.authority` so whoever holds the fee admin key (the deployer /
//! upgrade authority by default) can point the private-distribution leg at a relayer wallet and
//! change it at any time. `init_if_needed` makes the first call create the singleton and later
//! calls update it in place.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::{DistributorConfig, FeeConfig};

#[derive(Accounts)]
pub struct ConfigureDistributor<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + DistributorConfig::LEN,
        seeds = [b"distributor_config"],
        bump
    )]
    pub distributor_config: Account<'info, DistributorConfig>,

    /// Fee config singleton; its authority is the admin gate.
    #[account(
        seeds = [b"fee_config"],
        bump,
        constraint = fee_config.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub fee_config: Account<'info, FeeConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Create or update the distributor (relayer) the private-distribution leg routes vault funds to.
pub fn handler(ctx: Context<ConfigureDistributor>, distributor: Pubkey) -> Result<()> {
    let cfg = &mut ctx.accounts.distributor_config;
    cfg.distributor = distributor;
    msg!("Distributor (relayer) configured: {:?}", distributor);
    Ok(())
}

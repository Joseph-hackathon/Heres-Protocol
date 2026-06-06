//! Update the global platform fee config (authority only).

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::FeeConfig;

#[derive(Accounts)]
pub struct UpdateFeeConfig<'info> {
    #[account(
        mut,
        seeds = [b"fee_config"],
        bump,
        constraint = fee_config.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub fee_config: Account<'info, FeeConfig>,

    pub authority: Signer<'info>,
}

/// Update platform fee config (authority only).
pub fn handler(
    ctx: Context<UpdateFeeConfig>,
    creation_fee_lamports: u64,
    execution_fee_bps: u16,
) -> Result<()> {
    require!(execution_fee_bps <= 10000, ErrorCode::InvalidFeeConfig);
    let config = &mut ctx.accounts.fee_config;
    require!(config.authority == ctx.accounts.authority.key(), ErrorCode::Unauthorized);
    config.creation_fee_lamports = creation_fee_lamports;
    config.execution_fee_bps = execution_fee_bps;
    msg!(
        "Fee config updated: creation_fee={}, execution_bps={}",
        creation_fee_lamports,
        execution_fee_bps
    );
    Ok(())
}

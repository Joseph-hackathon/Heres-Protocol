//! Update the global platform fee config (authority only).

use anchor_lang::prelude::*;

use crate::constants::MAX_CREATION_FEE_LAMPORTS;
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

/// Update the platform creation fee (authority only). Lean model: creation fee only (redesign D3).
pub fn handler(ctx: Context<UpdateFeeConfig>, creation_fee_lamports: u64) -> Result<()> {
    require!(
        creation_fee_lamports <= MAX_CREATION_FEE_LAMPORTS,
        ErrorCode::InvalidFeeConfig
    );
    let config = &mut ctx.accounts.fee_config;
    config.creation_fee_lamports = creation_fee_lamports;
    msg!("Fee config updated: creation_fee={}", creation_fee_lamports);
    Ok(())
}

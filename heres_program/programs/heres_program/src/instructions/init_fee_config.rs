//! Initialize the global platform fee config (call once after deploy).

use anchor_lang::prelude::*;

use crate::constants::{MAX_CREATION_FEE_LAMPORTS, MAX_EXECUTION_FEE_BPS};
use crate::error::ErrorCode;
use crate::state::FeeConfig;

#[derive(Accounts)]
pub struct InitFeeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + FeeConfig::LEN,
        seeds = [b"fee_config"],
        bump
    )]
    pub fee_config: Account<'info, FeeConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// This program, used to resolve its ProgramData account.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ErrorCode::Unauthorized)]
    pub program: Program<'info, crate::program::HeresProgram>,

    /// The program's ProgramData (BPF upgradeable loader). Constrains init to the program's
    /// upgrade authority (the deployer), so the global fee singleton cannot be front-run on a
    /// fresh deploy by an attacker setting themselves as fee authority (audit C3).
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ ErrorCode::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

/// Initialize platform fee config (call once after deploy; only authority can update later).
pub fn handler(
    ctx: Context<InitFeeConfig>,
    fee_recipient: Pubkey,
    creation_fee_lamports: u64,
    execution_fee_bps: u16,
) -> Result<()> {
    // Cap the fee authority's reach (audit M2): execution fee <= 10%, creation fee <= 1 SOL.
    require!(execution_fee_bps <= MAX_EXECUTION_FEE_BPS, ErrorCode::InvalidFeeConfig);
    require!(creation_fee_lamports <= MAX_CREATION_FEE_LAMPORTS, ErrorCode::InvalidFeeConfig);
    let config = &mut ctx.accounts.fee_config;
    config.authority = ctx.accounts.authority.key();
    config.fee_recipient = fee_recipient;
    config.creation_fee_lamports = creation_fee_lamports;
    config.execution_fee_bps = execution_fee_bps;
    msg!(
        "Fee config initialized: recipient={:?}, creation_fee={}, execution_bps={}",
        fee_recipient,
        creation_fee_lamports,
        execution_fee_bps
    );
    Ok(())
}

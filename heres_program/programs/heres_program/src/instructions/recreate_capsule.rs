//! Recreate (reuse) an executed capsule: re-lock assets and reset lifecycle state in place.
//!
//! The per-owner PDA seeds allow exactly one capsule per wallet, so after execution the owner
//! cannot `create_capsule` again. This handler resets the existing executed capsule with a new
//! intent and freshly locked funds, fixing the post-execution dead-end (audit H2). The off-chain
//! client (`lib/solana.ts`) already calls `recreateCapsule` and the deployed IDL exposes it.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::state::{CapsuleVault, FeeConfig, IntentCapsule};
use crate::utils::{infer_asset_decimals, parse_amount_to_units};

#[derive(Accounts)]
pub struct RecreateCapsule<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump = capsule.bump,
        constraint = capsule.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    #[account(
        mut,
        seeds = [b"capsule_vault", owner.key().as_ref()],
        bump = capsule.vault_bump
    )]
    pub vault: Box<Account<'info, CapsuleVault>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,

    #[account(seeds = [b"fee_config"], bump)]
    pub fee_config: Box<Account<'info, FeeConfig>>,

    pub token_program: Option<Program<'info, Token>>,

    pub mint: Option<Box<Account<'info, Mint>>>,

    #[account(mut)]
    pub source_token_account: Option<Box<Account<'info, TokenAccount>>>,

    /// The vault's ATA. Must already exist (created at the original create_capsule). For SPL
    /// recreate, reuse the same mint so this ATA is present.
    #[account(mut)]
    pub vault_token_account: Option<Box<Account<'info, TokenAccount>>>,
}

/// Reset an executed capsule with a new intent and freshly locked assets. Owner-only.
pub fn handler(
    ctx: Context<RecreateCapsule>,
    inactivity_period: i64,
    intent_data: Vec<u8>,
) -> Result<()> {
    require!(inactivity_period > 0, ErrorCode::InvalidInactivityPeriod);
    {
        let capsule = &ctx.accounts.capsule;
        // Only reuse a capsule that has already executed (lifecycle reset after distribution).
        require!(!capsule.is_active, ErrorCode::CapsuleActive);
        require!(capsule.executed_at.is_some(), ErrorCode::CapsuleNotExecuted);
    }

    // Parse the new locked total from the new intent.
    let total_amount_units = {
        let intent_data_str =
            String::from_utf8(intent_data.clone()).map_err(|_| ErrorCode::InvalidIntentData)?;
        let intent_json: serde_json::Value =
            serde_json::from_str(&intent_data_str).map_err(|_| ErrorCode::InvalidIntentData)?;
        let total_str = intent_json
            .get("totalAmount")
            .and_then(|t| t.as_str())
            .ok_or(ErrorCode::InvalidIntentData)?;
        let asset_decimals =
            infer_asset_decimals(&intent_json, ctx.accounts.mint.as_ref().map(|m| m.decimals));
        parse_amount_to_units(total_str, asset_decimals).map_err(|_| ErrorCode::InvalidIntentData)?
    };

    // Re-lock funds into the existing vault.
    if let Some(mint) = &ctx.accounts.mint {
        let from_ata = ctx
            .accounts
            .source_token_account
            .as_ref()
            .ok_or(ErrorCode::InvalidTokenAccount)?;
        let to_ata = ctx
            .accounts
            .vault_token_account
            .as_ref()
            .ok_or(ErrorCode::InvalidTokenAccount)?;
        require!(to_ata.mint == mint.key(), ErrorCode::InvalidTokenAccount);
        let token_program = ctx
            .accounts
            .token_program
            .as_ref()
            .ok_or(ErrorCode::InvalidTokenAccount)?;
        let cpi_accounts = Transfer {
            from: from_ata.to_account_info(),
            to: to_ata.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        token::transfer(
            CpiContext::new(token_program.to_account_info(), cpi_accounts),
            total_amount_units,
        )?;
        ctx.accounts.capsule.mint = mint.key();
        msg!("Re-locked {} tokens for recreated capsule", total_amount_units);
    } else {
        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts),
            total_amount_units,
        )?;
        ctx.accounts.capsule.mint = Pubkey::default();
        msg!("Re-locked {} lamports for recreated capsule", total_amount_units);
    }

    let now = Clock::get()?.unix_timestamp;
    let capsule = &mut ctx.accounts.capsule;
    capsule.inactivity_period = inactivity_period;
    capsule.last_activity = now;
    capsule.intent_data = intent_data;
    capsule.is_active = true;
    capsule.executed_at = None;
    capsule.retry_count = 0;
    capsule.ccip_sent_bitmap = 0;
    capsule.private_distributed = false;
    capsule.distributed = false;
    capsule.locked_amount = total_amount_units;

    msg!("Capsule recreated for owner: {:?}", capsule.key());
    Ok(())
}

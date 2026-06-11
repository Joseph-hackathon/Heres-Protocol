//! Lock SOL or SPL into the Vault. Repeatable - the Vault holds native SOL plus one ATA per mint,
//! so multi-asset inheritance is just multiple deposits. The Vault stays on the base layer the
//! whole time (never delegated), so deposits work regardless of the Switch's delegation state.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::state::{CapsuleVault, IntentCapsule};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
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

    // SPL deposit path (all optional; omit for native SOL).
    pub token_program: Option<Program<'info, Token>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
    pub mint: Option<Box<Account<'info, Mint>>>,
    #[account(mut)]
    pub source_token_account: Option<Box<Account<'info, TokenAccount>>>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Option<Box<Account<'info, TokenAccount>>>,
}

/// Lock `amount` of an asset into the Vault. Owner only; capsule must be active.
pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(ctx.accounts.capsule.is_active, ErrorCode::CapsuleInactive);

    if let Some(mint) = &ctx.accounts.mint {
        let from_ata = ctx.accounts.source_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        let to_ata = ctx.accounts.vault_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        let token_program = ctx.accounts.token_program.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        require!(to_ata.mint == mint.key(), ErrorCode::InvalidTokenAccount);

        let cpi_accounts = Transfer {
            from: from_ata.to_account_info(),
            to: to_ata.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        token::transfer(CpiContext::new(token_program.to_account_info(), cpi_accounts), amount)?;
        msg!("Deposited {} of mint {:?} into vault", amount, mint.key());
    } else {
        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts),
            amount,
        )?;
        msg!("Deposited {} lamports into vault", amount);
    }
    Ok(())
}

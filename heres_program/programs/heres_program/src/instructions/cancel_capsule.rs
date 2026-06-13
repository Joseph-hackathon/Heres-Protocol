//! Owner-initiated cancel: reclaim locked assets and close the capsule while still alive (audit H2).
//!
//! Refunds the native SOL (via `close = owner` on the vault) plus, optionally, one SPL asset passed
//! explicitly. For a multi-mint vault, recover the extra mints via `recover_vault` first, then
//! cancel to close the SOL + accounts (closing the vault while it still owns ATAs would strand them).
//!
//! Closes all three PDAs (Switch + BeneficiarySet + Vault), so both the Switch (regular ER) and the
//! BeneficiarySet (TEE) must be undelegated back to base first - Anchor's Account<> owner-check
//! rejects a still-delegated account, so the client undelegates (crank_undelegate +
//! crank_undelegate_beneficiaries, owner-gated) before cancelling.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::state::{BeneficiarySet, CapsuleVault, IntentCapsule};

#[derive(Accounts)]
pub struct CancelCapsule<'info> {
    #[account(
        mut,
        close = owner,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump = capsule.bump,
        constraint = capsule.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    #[account(
        mut,
        close = owner,
        seeds = [b"beneficiary_set", owner.key().as_ref()],
        bump = beneficiary_set.bump,
        constraint = beneficiary_set.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub beneficiary_set: Box<Account<'info, BeneficiarySet>>,

    #[account(
        mut,
        close = owner,
        seeds = [b"capsule_vault", owner.key().as_ref()],
        bump = capsule.vault_bump,
    )]
    pub vault: Box<Account<'info, CapsuleVault>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,

    // Optional SPL refund leg (omit for a SOL-only vault).
    pub token_program: Option<Program<'info, Token>>,
    pub mint: Option<Box<Account<'info, Mint>>>,
    #[account(mut)]
    pub vault_token_account: Option<Box<Account<'info, TokenAccount>>>,
    /// CHECK: owner's ATA receiving the refunded tokens; validated as owner+mint ATA in handler.
    #[account(mut)]
    pub owner_token_account: Option<AccountInfo<'info>>,
}

/// Cancel an active (not-yet-fired) capsule: refund assets to the owner and close the accounts.
pub fn handler(ctx: Context<CancelCapsule>) -> Result<()> {
    // Only a living owner can reclaim, and only before the switch fires.
    require!(ctx.accounts.capsule.is_active, ErrorCode::CapsuleInactive);

    if let Some(mint) = &ctx.accounts.mint {
        let vault_ata = ctx.accounts.vault_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        let owner_ata = ctx.accounts.owner_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        let token_program = ctx.accounts.token_program.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        require!(
            vault_ata.key() == get_associated_token_address(&ctx.accounts.vault.key(), &mint.key()),
            ErrorCode::InvalidTokenAccount
        );
        require!(
            owner_ata.key() == get_associated_token_address(&ctx.accounts.owner.key(), &mint.key()),
            ErrorCode::InvalidTokenAccount
        );

        let owner_key = ctx.accounts.owner.key();
        let vault_bump = ctx.accounts.capsule.vault_bump;
        let vault_seeds: &[&[u8]] = &[b"capsule_vault", owner_key.as_ref(), &[vault_bump]];
        let signer_seeds = &[vault_seeds];

        let amount = vault_ata.amount;
        if amount > 0 {
            let cpi_accounts = Transfer {
                from: vault_ata.to_account_info(),
                to: owner_ata.clone(),
                authority: ctx.accounts.vault.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(token_program.to_account_info(), cpi_accounts, signer_seeds),
                amount,
            )?;
        }
        let close_accounts = CloseAccount {
            account: vault_ata.to_account_info(),
            destination: ctx.accounts.owner.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        token::close_account(CpiContext::new_with_signer(
            token_program.to_account_info(),
            close_accounts,
            signer_seeds,
        ))?;
        msg!("Refunded {} SPL tokens to owner on cancel", amount);
    }

    // `close = owner` on capsule + vault refunds their rent and, for SOL, the locked lamports.
    msg!("Capsule cancelled and assets reclaimed for owner: {:?}", ctx.accounts.owner.key());
    Ok(())
}

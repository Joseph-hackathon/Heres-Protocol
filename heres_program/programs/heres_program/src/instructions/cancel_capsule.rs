//! Owner-initiated cancel: reclaim locked assets and close the capsule while still alive.
//! Fixes the "no way out while alive" lifecycle gap (audit H2): a living owner can withdraw
//! everything and free the per-owner PDA so a new capsule can be created.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::state::{CapsuleVault, IntentCapsule};

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
        seeds = [b"capsule_vault", owner.key().as_ref()],
        bump = capsule.vault_bump,
    )]
    pub vault: Box<Account<'info, CapsuleVault>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,

    // SPL refund path. Required when the capsule holds an SPL asset (capsule.mint != default).
    pub token_program: Option<Program<'info, Token>>,
    pub mint: Option<Box<Account<'info, Mint>>>,
    #[account(mut)]
    pub vault_token_account: Option<Box<Account<'info, TokenAccount>>>,
    /// CHECK: owner's ATA receiving the refunded tokens; validated as the owner+mint ATA in handler.
    #[account(mut)]
    pub owner_token_account: Option<AccountInfo<'info>>,
}

/// Cancel an active (not-yet-executed) capsule: refund all locked assets to the owner and close
/// the capsule + vault. Owner-only. After execution, funds follow the distribution path instead;
/// use `recreate_capsule` to reuse an executed capsule.
pub fn handler(ctx: Context<CancelCapsule>) -> Result<()> {
    let capsule = &ctx.accounts.capsule;
    // Only a living owner can reclaim, and only before the inactivity trigger fires.
    require!(capsule.is_active, ErrorCode::CapsuleInactive);

    let is_spl = capsule.mint != Pubkey::default();
    if is_spl {
        let mint = ctx.accounts.mint.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        require!(mint.key() == capsule.mint, ErrorCode::InvalidTokenAccount);
        let vault_ata = ctx
            .accounts
            .vault_token_account
            .as_ref()
            .ok_or(ErrorCode::InvalidTokenAccount)?;
        let owner_ata = ctx
            .accounts
            .owner_token_account
            .as_ref()
            .ok_or(ErrorCode::InvalidTokenAccount)?;
        let token_program = ctx
            .accounts
            .token_program
            .as_ref()
            .ok_or(ErrorCode::InvalidTokenAccount)?;

        let expected_owner_ata = get_associated_token_address(&ctx.accounts.owner.key(), &mint.key());
        require!(owner_ata.key() == expected_owner_ata, ErrorCode::InvalidTokenAccount);

        let owner_key = ctx.accounts.owner.key();
        let vault_bump = capsule.vault_bump;
        let vault_seeds: &[&[u8]] = &[b"capsule_vault", owner_key.as_ref(), &[vault_bump]];
        let signer_seeds = &[vault_seeds];

        let amount = vault_ata.amount;
        if amount > 0 {
            let cpi_accounts = Transfer {
                from: vault_ata.to_account_info(),
                to: owner_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(token_program.to_account_info(), cpi_accounts, signer_seeds),
                amount,
            )?;
        }
        // Reclaim the vault ATA rent back to the owner.
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

    // `close = owner` on capsule + vault refunds their rent and, for SOL capsules, the locked
    // lamports held in the vault PDA.
    msg!("Capsule cancelled and assets reclaimed for owner: {:?}", ctx.accounts.owner.key());
    Ok(())
}

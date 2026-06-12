//! Owner escape hatch: pull one asset out of the Vault while the capsule is still active, WITHOUT
//! touching the Switch.
//!
//! Covers the case where the Switch is stuck delegated to a dead validator: the Vault is always on
//! the base layer (never delegated), so funds stay recoverable even when the gating Switch is
//! frozen. Owner-only, pre-fire. Call once per asset (None mint = native SOL).

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::state::{CapsuleVault, IntentCapsule};

#[derive(Accounts)]
pub struct RecoverVault<'info> {
    /// CHECK: the Switch PDA, validated by seeds. Read as a raw AccountInfo (NOT
    /// Account<IntentCapsule>) on purpose: while the Switch is delegated its owner is the delegation
    /// program, so an Account<IntentCapsule> would fail Anchor's owner check - and the stuck-delegated
    /// (dead validator) case is exactly what this escape hatch exists for. Authorization is the owner
    /// signer + the owner-seeded vault, not this account.
    #[account(seeds = [b"intent_capsule", owner.key().as_ref()], bump)]
    pub capsule: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"capsule_vault", owner.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, CapsuleVault>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,

    // SPL leg (omit for native SOL).
    pub token_program: Option<Program<'info, Token>>,
    pub mint: Option<Box<Account<'info, Mint>>>,
    #[account(mut)]
    pub vault_token_account: Option<Box<Account<'info, TokenAccount>>>,
    /// CHECK: owner's ATA receiving the recovered tokens; validated as owner+mint ATA in handler.
    #[account(mut)]
    pub owner_token_account: Option<AccountInfo<'info>>,
}

/// Recover one Vault asset to the owner. Pre-fire only; after firing, funds follow distribution.
pub fn handler(ctx: Context<RecoverVault>) -> Result<()> {
    // The Switch may be delegated to the ER/TEE - possibly to a dead validator. The Vault is always
    // on the base layer, so the owner can still pull funds out here. We only consult the Switch state
    // when it is on the base layer (program-owned): there we keep the pre-fire-only policy so a live,
    // base-layer capsule still routes to beneficiaries after it fires. When the Switch is delegated
    // we cannot (and need not) read it - the owner signer + owner-seeded vault authorize the escape.
    let cap_ai = &ctx.accounts.capsule;
    if cap_ai.owner == &crate::ID {
        let data = cap_ai.try_borrow_data()?;
        let cap = IntentCapsule::try_deserialize(&mut &data[..])?;
        require!(cap.is_active, ErrorCode::CapsuleInactive);
    }

    let owner_key = ctx.accounts.owner.key();
    let vault_bump = ctx.bumps.vault;
    let vault_seeds: &[&[u8]] = &[b"capsule_vault", owner_key.as_ref(), &[vault_bump]];
    let signer_seeds = &[vault_seeds];

    if let Some(mint) = &ctx.accounts.mint {
        let token_program = ctx.accounts.token_program.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        let vault_ata = ctx.accounts.vault_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        let owner_ata = ctx.accounts.owner_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        require!(
            vault_ata.key() == get_associated_token_address(&ctx.accounts.vault.key(), &mint.key()),
            ErrorCode::InvalidTokenAccount
        );
        require!(
            owner_ata.key() == get_associated_token_address(&owner_key, &mint.key()),
            ErrorCode::InvalidTokenAccount
        );

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
        // Reclaim the ATA rent back to the owner and remove it from the vault's manifest.
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
        msg!("Recovered {} SPL tokens of mint {:?} to owner", amount, mint.key());
    } else {
        let vault_ai = ctx.accounts.vault.to_account_info();
        let rent_floor = Rent::get()?.minimum_balance(vault_ai.data_len());
        let available = vault_ai.lamports().saturating_sub(rent_floor);
        require!(available > 0, ErrorCode::NothingToDistribute);
        **vault_ai.try_borrow_mut_lamports()? -= available;
        **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += available;
        msg!("Recovered {} lamports to owner", available);
    }
    Ok(())
}

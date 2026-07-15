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
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

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

    // Optional SPL refund leg (omit for a SOL-only vault). Interface types accept classic SPL + Token-2022.
    pub token_program: Option<Interface<'info, TokenInterface>>,
    pub mint: Option<Box<InterfaceAccount<'info, Mint>>>,
    #[account(mut)]
    pub vault_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    /// CHECK: owner's ATA receiving the refunded tokens; validated as owner+mint ATA in handler.
    #[account(mut)]
    pub owner_token_account: Option<AccountInfo<'info>>,
}

/// Cancel an active (not-yet-fired) capsule: refund assets to the owner and close the accounts.
pub fn handler(ctx: Context<CancelCapsule>) -> Result<()> {
    // Only a living owner can reclaim, and only before the switch fires. Drafts are cancellable so
    // an interrupted create flow cannot strand the owner's assets or per-owner PDAs.
    require!(
        ctx.accounts.capsule.executed_at.is_none(),
        ErrorCode::CapsuleInactive
    );

    if let Some(mint) = &ctx.accounts.mint {
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
        let token_program_id = token_program.key();
        require!(
            vault_ata.key()
                == get_associated_token_address_with_program_id(
                    &ctx.accounts.vault.key(),
                    &mint.key(),
                    &token_program_id
                ),
            ErrorCode::InvalidTokenAccount
        );
        require!(
            owner_ata.key()
                == get_associated_token_address_with_program_id(
                    &ctx.accounts.owner.key(),
                    &mint.key(),
                    &token_program_id
                ),
            ErrorCode::InvalidTokenAccount
        );

        let owner_key = ctx.accounts.owner.key();
        let vault_bump = ctx.accounts.capsule.vault_bump;
        let vault_seeds: &[&[u8]] = &[b"capsule_vault", owner_key.as_ref(), &[vault_bump]];
        let signer_seeds = &[vault_seeds];

        let amount = vault_ata.amount;
        if amount > 0 {
            let cpi_accounts = TransferChecked {
                from: vault_ata.to_account_info(),
                mint: mint.to_account_info(),
                to: owner_ata.clone(),
                authority: ctx.accounts.vault.to_account_info(),
            };
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    cpi_accounts,
                    signer_seeds,
                ),
                amount,
                mint.decimals,
            )?;
        }
        let close_accounts = CloseAccount {
            account: vault_ata.to_account_info(),
            destination: ctx.accounts.owner.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        token_interface::close_account(CpiContext::new_with_signer(
            token_program.to_account_info(),
            close_accounts,
            signer_seeds,
        ))?;
        ctx.accounts.vault.unregister_token_asset();
        msg!("Refunded {} SPL tokens to owner on cancel", amount);
    }

    // close = owner sweeps native SOL and reclaimed token-account rent. Only a real SOL deposit is
    // represented by the native manifest flag; clearing an absent flag is intentionally a no-op.
    ctx.accounts.vault.unregister_native_asset();
    if ctx.accounts.vault.tracks_assets() {
        require!(
            ctx.accounts.vault.asset_count() == 0,
            ErrorCode::VaultNotEmpty
        );
    }

    // `close = owner` on capsule + vault refunds their rent and, for SOL, the locked lamports.
    msg!(
        "Capsule cancelled and assets reclaimed for owner: {:?}",
        ctx.accounts.owner.key()
    );
    Ok(())
}

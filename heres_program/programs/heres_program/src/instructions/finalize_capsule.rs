//! Close a fully settled capsule and return its account rent to the configured protocol fee recipient.
//!
//! The owner or configured protocol heartbeat authority may finalize. The caller cannot redirect
//! rent: FeeConfig pins the only valid destination.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::events::CapsuleFinalized;
use crate::state::{BeneficiarySet, CapsuleVault, FeeConfig, IntentCapsule};

#[derive(Accounts)]
pub struct FinalizeCapsule<'info> {
    #[account(
        mut,
        close = fee_recipient,
        seeds = [b"intent_capsule", capsule.owner.as_ref()],
        bump = capsule.bump,
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    #[account(
        mut,
        close = fee_recipient,
        seeds = [b"beneficiary_set", capsule.owner.as_ref()],
        bump = capsule.beneficiaries_bump,
        constraint = beneficiary_set.owner == capsule.owner @ ErrorCode::Unauthorized,
    )]
    pub beneficiary_set: Box<Account<'info, BeneficiarySet>>,

    #[account(
        mut,
        close = fee_recipient,
        seeds = [b"capsule_vault", capsule.owner.as_ref()],
        bump = capsule.vault_bump,
    )]
    pub vault: Box<Account<'info, CapsuleVault>>,

    pub authority: Signer<'info>,

    #[account(seeds = [b"fee_config"], bump)]
    pub fee_config: Box<Account<'info, FeeConfig>>,

    /// CHECK: exact address is pinned by FeeConfig. It only receives lamports from account closure.
    #[account(
        mut,
        address = fee_config.fee_recipient @ ErrorCode::InvalidFeeConfig,
    )]
    pub fee_recipient: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<FinalizeCapsule>) -> Result<()> {
    let capsule = &ctx.accounts.capsule;
    let authority = ctx.accounts.authority.key();
    require!(
        authority == capsule.owner || authority == capsule.heartbeat_authority,
        ErrorCode::Unauthorized
    );
    require!(!capsule.is_active, ErrorCode::CapsuleActive);
    require!(capsule.executed_at.is_some(), ErrorCode::CapsuleNotExecuted);
    let vault_ai = ctx.accounts.vault.to_account_info();
    let rent_floor = Rent::get()?.minimum_balance(vault_ai.data_len());
    require!(vault_ai.lamports() <= rent_floor, ErrorCode::VaultNotEmpty);
    if ctx.accounts.vault.uses_registered_token_markers() {
        require!(
            ctx.accounts.vault.asset_count() == 0,
            ErrorCode::VaultNotEmpty
        );
    } else {
        // Legacy vaults have no trustworthy mint manifest. Only the owner may acknowledge that the
        // client-side token scan is empty and close the settled lifecycle; the protocol relayer may
        // not make that irreversible compatibility decision on the owner's behalf.
        require!(authority == capsule.owner, ErrorCode::Unauthorized);
    }

    let rent_reclaimed = ctx
        .accounts
        .capsule
        .to_account_info()
        .lamports()
        .saturating_add(ctx.accounts.beneficiary_set.to_account_info().lamports())
        .saturating_add(ctx.accounts.vault.to_account_info().lamports());

    emit!(CapsuleFinalized {
        capsule: capsule.key(),
        owner: capsule.owner,
        fee_recipient: ctx.accounts.fee_recipient.key(),
        rent_reclaimed,
    });
    msg!(
        "Capsule finalized; {} lamports reclaimed to protocol fee recipient {:?}",
        rent_reclaimed,
        ctx.accounts.fee_recipient.key()
    );
    Ok(())
}

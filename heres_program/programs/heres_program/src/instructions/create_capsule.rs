//! Create the Switch + BeneficiarySet + Vault for an owner. Liveness + heartbeat authority +
//! creation fee only.
//!
//! Funds are added separately via `deposit` (repeatable, multi-asset). Beneficiaries are NOT taken
//! here and never written to the base ledger in plaintext - they are set privately via
//! `update_intent` on the TEE after the BeneficiarySet is delegated (redesign D8). All three PDAs are
//! initialized empty here. Seeds: capsule / beneficiary_set / vault per owner.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::error::ErrorCode;
use crate::state::{BeneficiarySet, CapsuleVault, FeeConfig, IntentCapsule};

#[derive(Accounts)]
pub struct CreateCapsule<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + IntentCapsule::LEN,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    #[account(
        init,
        payer = owner,
        space = 8 + BeneficiarySet::LEN,
        seeds = [b"beneficiary_set", owner.key().as_ref()],
        bump
    )]
    pub beneficiary_set: Box<Account<'info, BeneficiarySet>>,

    #[account(
        init,
        payer = owner,
        space = 8 + CapsuleVault::LEN,
        seeds = [b"capsule_vault", owner.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, CapsuleVault>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [b"fee_config"], bump)]
    pub fee_config: Box<Account<'info, FeeConfig>>,

    /// Platform fee recipient (must match fee_config.fee_recipient when creation_fee_lamports > 0).
    /// CHECK: validated against fee_config.fee_recipient in the handler.
    #[account(mut)]
    pub platform_fee_recipient: Option<AccountInfo<'info>>,

    pub system_program: Program<'info, System>,
}

/// Initialize a new Switch + BeneficiarySet + Vault. Charges the one-time creation fee; no funds
/// locked and no beneficiaries set yet.
pub fn handler(
    ctx: Context<CreateCapsule>,
    inactivity_period: i64,
    heartbeat_authority: Pubkey,
    target_date: Option<i64>,
) -> Result<()> {
    // A non-positive inactivity period would make the capsule instantly firable by anyone (audit M3).
    require!(inactivity_period > 0, ErrorCode::InvalidInactivityPeriod);

    let fee_config = &ctx.accounts.fee_config;
    if fee_config.creation_fee_lamports > 0 {
        let platform_recipient = ctx
            .accounts
            .platform_fee_recipient
            .as_ref()
            .ok_or(ErrorCode::InvalidFeeConfig)?;
        require!(
            platform_recipient.key() == fee_config.fee_recipient,
            ErrorCode::InvalidFeeConfig
        );

        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to: platform_recipient.clone(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
        system_program::transfer(cpi_ctx, fee_config.creation_fee_lamports)?;
        msg!(
            "Creation fee {} lamports sent to {:?}",
            fee_config.creation_fee_lamports,
            platform_recipient.key()
        );
    }

    let now = Clock::get()?.unix_timestamp;

    // An absolute target date in the past would make the capsule instantly firable (same hazard as a
    // non-positive inactivity period). None = inactivity-only (the original dead-man's-switch behavior).
    if let Some(t) = target_date {
        require!(t > now, ErrorCode::InvalidTargetDate);
    }

    let capsule = &mut ctx.accounts.capsule;
    capsule.owner = ctx.accounts.owner.key();
    capsule.inactivity_period = inactivity_period;
    capsule.last_activity = now;
    // New capsules begin as drafts. The private TEE configuration is written and sealed first;
    // arm_capsule then activates this Switch with the matching commitment on the regular ER.
    capsule.is_active = false;
    capsule.executed_at = None;
    capsule.bump = ctx.bumps.capsule;
    capsule.vault_bump = ctx.bumps.vault;
    capsule.beneficiaries_bump = ctx.bumps.beneficiary_set;
    capsule.heartbeat_authority = heartbeat_authority;
    capsule.version = IntentCapsule::CURRENT_VERSION;
    capsule.target_date = target_date;
    capsule.reserved = [0u8; 55];

    let beneficiary_set = &mut ctx.accounts.beneficiary_set;
    beneficiary_set.owner = ctx.accounts.owner.key();
    beneficiary_set.bump = ctx.bumps.beneficiary_set;
    beneficiary_set.version = BeneficiarySet::CURRENT_VERSION;
    beneficiary_set.beneficiaries = Vec::new();
    beneficiary_set.nft_assignments = Vec::new();
    beneficiary_set.reserved = [0u8; 64];

    ctx.accounts.vault.initialize_tracked();

    msg!(
        "Switch + BeneficiarySet + Vault created for owner: {:?}",
        capsule.owner
    );
    Ok(())
}

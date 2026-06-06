//! Delegate the capsule + vault PDAs to the MagicBlock ER/PER.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::TEE_VALIDATOR;

#[delegate]
#[derive(Accounts)]
pub struct DelegateCapsuleInput<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    /// CHECK: Checked by the delegation program
    pub validator: Option<AccountInfo<'info>>,
    /// CHECK: PDA to delegate (capsule); seeds: [b"intent_capsule", owner]
    #[account(mut, del, seeds = [b"intent_capsule", owner.key().as_ref()], bump)]
    pub pda: AccountInfo<'info>,
    /// CHECK: PDA to delegate (vault); seeds: [b"capsule_vault", owner]
    #[account(mut, del, seeds = [b"capsule_vault", owner.key().as_ref()], bump)]
    pub vault: AccountInfo<'info>,
    /// CHECK: Magic program
    pub magic_program: AccountInfo<'info>,
    /// CHECK: Delegation program
    pub delegation_program: AccountInfo<'info>,
    /// CHECK: System program
    pub system_program: Program<'info, System>,
}

/// Delegate capsule and vault PDAs to Magicblock ER/PER. When no validator is passed, defaults to TEE validator (PER).
/// The #[delegate] macro handles this automatically for all fields marked with 'del'.
pub fn handler(ctx: Context<DelegateCapsuleInput>) -> Result<()> {
    let validator_key = ctx
        .accounts
        .validator
        .as_ref()
        .map(|v| v.key())
        .unwrap_or(TEE_VALIDATOR);

    msg!("Delegating capsule and vault to Ephemeral Rollup");
    let owner_key = ctx.accounts.owner.key();

    // Delegate Capsule PDA
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[b"intent_capsule", owner_key.as_ref()],
        DelegateConfig {
            commit_frequency_ms: 0,
            validator: Some(validator_key),
        },
    )?;

    // Delegate Vault PDA
    ctx.accounts.delegate_vault(
        &ctx.accounts.payer,
        &[b"capsule_vault", owner_key.as_ref()],
        DelegateConfig {
            commit_frequency_ms: 0,
            validator: Some(validator_key),
        },
    )?;

    msg!("Capsule and Vault delegated to Ephemeral Rollup");
    Ok(())
}

//! Delegate the Switch (capsule PDA) to the MagicBlock ER/PER.
//!
//! Only the Switch is delegated; the Vault stays on the base layer the whole time. That keeps funds
//! base-recoverable via recover_vault even if the validator dies, and makes multi-asset orthogonal
//! to delegation (token accounts are never delegated).

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
    /// CHECK: checked by the delegation program.
    pub validator: Option<AccountInfo<'info>>,
    /// CHECK: the Switch PDA to delegate; seeds [b"intent_capsule", owner].
    #[account(mut, del, seeds = [b"intent_capsule", owner.key().as_ref()], bump)]
    pub pda: AccountInfo<'info>,
    /// CHECK: Magic program.
    pub magic_program: AccountInfo<'info>,
    /// CHECK: Delegation program.
    pub delegation_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

/// Delegate the Switch to MagicBlock ER/PER. Defaults to the TEE validator (PER) when none passed.
pub fn handler(ctx: Context<DelegateCapsuleInput>) -> Result<()> {
    let validator_key = ctx
        .accounts
        .validator
        .as_ref()
        .map(|v| v.key())
        .unwrap_or(TEE_VALIDATOR);
    let owner_key = ctx.accounts.owner.key();

    msg!("Delegating Switch to Ephemeral Rollup (validator {:?})", validator_key);
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[b"intent_capsule", owner_key.as_ref()],
        DelegateConfig {
            commit_frequency_ms: 0,
            validator: Some(validator_key),
        },
    )?;
    msg!("Switch delegated to Ephemeral Rollup");
    Ok(())
}

//! Delegate the Switch (capsule PDA) to a *regular* MagicBlock ER.
//!
//! The Switch holds only liveness (no private state), so it does NOT go behind a PER permission and
//! does NOT live on the TEE. Putting it on a standard ER is what makes heartbeats gasless AND
//! token-free: the relayer submits update_activity over a normal ER RPC, never minting a TEE auth
//! token. The MagicBlock ScheduleTask fires execute_intent autonomously on this ER.
//!
//! The private beneficiary list is delegated separately to the TEE (see delegate_beneficiaries). The
//! Vault is never delegated. commit_frequency_ms: 0 => no periodic commits; state settles once, at
//! undelegate.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{delegate, DelegationProgram, MagicProgram};
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::DEFAULT_ER_VALIDATOR;

#[delegate]
#[derive(Accounts)]
pub struct DelegateCapsuleInput<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    /// CHECK: checked by the delegation program. Defaults to DEFAULT_ER_VALIDATOR (a regular ER).
    pub validator: Option<AccountInfo<'info>>,
    /// CHECK: the Switch PDA to delegate; seeds [b"intent_capsule", owner].
    #[account(mut, del, seeds = [b"intent_capsule", owner.key().as_ref()], bump)]
    pub pda: AccountInfo<'info>,
    pub magic_program: Program<'info, MagicProgram>,
    pub delegation_program: Program<'info, DelegationProgram>,
    pub system_program: Program<'info, System>,
}

/// Delegate the Switch to a regular ER. Idempotent: a no-op if already delegated.
pub fn handler(ctx: Context<DelegateCapsuleInput>) -> Result<()> {
    if ctx.accounts.pda.owner == &ephemeral_rollups_sdk::id() {
        msg!("Switch already delegated; skipping");
        return Ok(());
    }

    let validator_key = ctx
        .accounts
        .validator
        .as_ref()
        .map(|v| v.key())
        .unwrap_or(DEFAULT_ER_VALIDATOR);
    let owner_key = ctx.accounts.owner.key();

    msg!(
        "Delegating Switch to regular ER (validator {:?})",
        validator_key
    );
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &[b"intent_capsule", owner_key.as_ref()],
        DelegateConfig {
            commit_frequency_ms: 0,
            validator: Some(validator_key),
        },
    )?;
    msg!("Switch delegated to regular ER");
    Ok(())
}

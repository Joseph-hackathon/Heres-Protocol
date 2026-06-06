//! Execute the intent when the inactivity period elapses. Permissionless (no owner signature).
//! Optimized for ER/TEE: only updates capsule state; distribution happens on the base layer.

use anchor_lang::prelude::*;

use crate::constants::PERMISSION_PROGRAM_ID;
use crate::error::ErrorCode;
use crate::events::IntentExecuted;
use crate::state::IntentCapsule;

#[derive(Accounts)]
pub struct ExecuteIntent<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", capsule.owner.as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    /// CHECK: Vault PDA
    #[account(
        mut,
        seeds = [b"capsule_vault", capsule.owner.as_ref()],
        bump = capsule.vault_bump
    )]
    pub vault: AccountInfo<'info>,

    /// MagicBlock Permission Program
    /// CHECK: Validated by address
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,

    /// CHECK: PDA for access control; seeds [b"permission", capsule]
    #[account(
        seeds = [b"permission", capsule.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub permission: AccountInfo<'info>,
}

/// Execute the intent when inactivity period is met. Anyone can call (no owner signature required).
/// This instruction is optimized for ER/TEE: it only updates the capsule state.
/// Actual distribution happens on the base layer via distribute_assets.
pub fn handler(ctx: Context<ExecuteIntent>) -> Result<()> {
    let capsule = &mut ctx.accounts.capsule;
    require!(capsule.is_active, ErrorCode::CapsuleInactive);

    let current_time = Clock::get()?.unix_timestamp;
    let time_since_activity = current_time - capsule.last_activity;

    require!(
        time_since_activity >= capsule.inactivity_period,
        ErrorCode::InactivityPeriodNotMet
    );

    // FAIL-SAFE / AUTO-RESTART:
    // If the execution is triggered but we want to "delay" it or if it's a re-occurring check,
    // we could reset the timer instead.
    // For now, we follow the standard execute -> deactivate flow.

    capsule.is_active = false;
    capsule.executed_at = Some(current_time);

    msg!("Intent executed (state updated) for capsule: {:?}", capsule.key());
    emit!(IntentExecuted {
        capsule: capsule.key(),
        owner: capsule.owner,
        executed_at: current_time,
    });

    // NOTE: commit_and_undelegate cannot be in the same instruction as state changes
    // because Solana runtime detects ExternalAccountDataModified when Magic program
    // changes ownership metadata on accounts we already modified.
    // Undelegation must be handled in a separate transaction after execution.

    Ok(())
}

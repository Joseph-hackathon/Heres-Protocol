//! Fire the Switch when the inactivity period elapses. Permissionless (no owner signature) and
//! state-only: it flips is_active -> false and stamps executed_at. Funds never move here; payout
//! happens on the base layer via distribute_assets after undelegation + the grace window.
//!
//! The Switch lives on a *regular* ER (no PER permission), so this references only the Switch. The
//! MagicBlock ScheduleTask runs it autonomously on that ER.

use anchor_lang::prelude::*;

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
}

/// Fire the switch once the owner has been silent for inactivity_period. Anyone can call (this is
/// the crank path); the MagicBlock ScheduleTask runs it autonomously on the ER.
pub fn handler(ctx: Context<ExecuteIntent>) -> Result<()> {
    let capsule = &mut ctx.accounts.capsule;
    require!(capsule.is_active, ErrorCode::CapsuleInactive);

    let now = Clock::get()?.unix_timestamp;
    require!(
        now - capsule.last_activity >= capsule.inactivity_period,
        ErrorCode::InactivityPeriodNotMet
    );

    capsule.is_active = false;
    capsule.executed_at = Some(now);

    msg!("Switch fired (state updated) for capsule: {:?}", capsule.key());
    emit!(IntentExecuted {
        capsule: capsule.key(),
        owner: capsule.owner,
        executed_at: now,
    });

    // commit_and_undelegate cannot share an instruction with these state changes: the runtime
    // flags ExternalAccountDataModified when the Magic program rewrites ownership metadata on an
    // account we already mutated. Undelegation is a separate crank tx (crank_undelegate).
    Ok(())
}

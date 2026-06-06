//! Reset the inactivity timer (fail-safe / auto-restart).

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::IntentCapsule;

#[derive(Accounts)]
pub struct RestartTimer<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", capsule.owner.as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    /// Must be the capsule owner. Enforced in the handler against `capsule.owner`.
    pub authority: Signer<'info>,
}

/// Reset the inactivity timer (Fail-safe / Auto-restart).
/// Allows the owner or the system (via TEE) to restart the countdown.
/// This is used if the Crank needs to be rebooted or if the owner proves they are still active.
pub fn handler(ctx: Context<RestartTimer>) -> Result<()> {
    let capsule = &mut ctx.accounts.capsule;
    // Owner-only: a permissionless reset lets anyone keep last_activity fresh forever and
    // block the inactivity trigger indefinitely (audit H3 / backlog A5 griefing vuln).
    // If a protocol crank/TEE ever needs to reset, gate that on an allowlisted authority
    // stored in FeeConfig rather than reopening this to any signer.
    require!(capsule.owner == ctx.accounts.authority.key(), ErrorCode::Unauthorized);
    require!(capsule.is_active, ErrorCode::CapsuleInactive);

    // The owner proves they are still active ("I'm alive" signal), resetting the countdown.
    capsule.last_activity = Clock::get()?.unix_timestamp;
    capsule.retry_count += 1;

    msg!(
        "Timer restarted for capsule: {:?}. New last_activity: {}",
        capsule.key(),
        capsule.last_activity
    );
    Ok(())
}

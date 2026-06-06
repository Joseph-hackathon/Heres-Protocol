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

    /// Can be the owner or any authorized signer/crank
    pub authority: Signer<'info>,
}

/// Reset the inactivity timer (Fail-safe / Auto-restart).
/// Allows the owner or the system (via TEE) to restart the countdown.
/// This is used if the Crank needs to be rebooted or if the owner proves they are still active.
pub fn handler(ctx: Context<RestartTimer>) -> Result<()> {
    let capsule = &mut ctx.accounts.capsule;
    require!(capsule.is_active, ErrorCode::CapsuleInactive);

    // In a real TEE fail-safe, this could be triggered by an external "I'm alive" signal
    // or by the TEE itself if a previous execution cycle failed to reach L1.
    capsule.last_activity = Clock::get()?.unix_timestamp;
    capsule.retry_count += 1;

    msg!(
        "Timer restarted for capsule: {:?}. New last_activity: {}",
        capsule.key(),
        capsule.last_activity
    );
    Ok(())
}

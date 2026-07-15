//! Proof-of-life: bump last_activity, or revive the capsule during the post-fire grace window.
//!
//! Accepts the owner OR the heartbeat_authority (the off-chain relayer that records owner-signed
//! wallet activity). Folds in the old restart_timer (the manual "I'm alive" reset is just an
//! activity bump while the capsule is active).

use anchor_lang::prelude::*;

use crate::constants::GRACE_PERIOD;
use crate::error::ErrorCode;
use crate::state::IntentCapsule;

#[derive(Accounts)]
pub struct UpdateActivity<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", capsule.owner.as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    /// Owner OR heartbeat_authority - enforced in the handler against the capsule.
    pub authority: Signer<'info>,
}

/// Bump the liveness clock, or (if fired but still in grace) revive the capsule.
pub fn handler(ctx: Context<UpdateActivity>) -> Result<()> {
    let capsule = &mut ctx.accounts.capsule;
    let signer = ctx.accounts.authority.key();
    let is_owner = signer == capsule.owner;
    require!(
        is_owner || signer == capsule.heartbeat_authority,
        ErrorCode::Unauthorized
    );

    let now = Clock::get()?.unix_timestamp;

    if capsule.is_active {
        // Steady state: refresh the liveness clock (owner or relayer).
        capsule.last_activity = now;
        msg!("Activity bumped for capsule: {:?}", capsule.key());
    } else if let Some(executed_at) = capsule.executed_at {
        // Fired, but liveness was proven before distribution: revive within the grace window.
        // Revival is OWNER-ONLY - a stronger action than a bump. A compromised heartbeat relayer
        // must not be able to resurrect a fired switch and block inheritance indefinitely.
        // After grace elapses, revival is no longer possible - use recreate_capsule instead.
        require!(is_owner, ErrorCode::Unauthorized);
        require!(now < executed_at + GRACE_PERIOD, ErrorCode::CapsuleInactive);
        capsule.is_active = true;
        capsule.executed_at = None;
        capsule.last_activity = now;
        msg!(
            "Capsule revived during grace window (owner): {:?}",
            capsule.key()
        );
    } else {
        return err!(ErrorCode::CapsuleInactive);
    }

    Ok(())
}

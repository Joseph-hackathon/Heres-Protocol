//! Proof-of-life: bump last_activity while the capsule is active.
//!
//! Accepts the owner OR the heartbeat_authority (the off-chain relayer that records owner-signed
//! wallet activity). Folds in the old restart_timer (the manual "I'm alive" reset is just an
//! activity bump while the capsule is active).

use anchor_lang::prelude::*;

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

/// Bump the liveness clock while the capsule is active.
pub fn handler(ctx: Context<UpdateActivity>) -> Result<()> {
    let capsule = &mut ctx.accounts.capsule;
    let signer = ctx.accounts.authority.key();
    require!(
        signer == capsule.owner || signer == capsule.heartbeat_authority,
        ErrorCode::Unauthorized
    );
    require!(capsule.is_active, ErrorCode::CapsuleInactive);

    let now = Clock::get()?.unix_timestamp;
    capsule.last_activity = now;
    msg!("Activity bumped for capsule: {:?}", capsule.key());

    Ok(())
}

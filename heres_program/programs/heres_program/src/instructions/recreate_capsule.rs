//! Reuse an executed capsule: reset its lifecycle in place.
//!
//! The per-owner PDA allows only one capsule per wallet, so after firing the owner cannot
//! create_capsule again. This resets the Switch (clears beneficiaries + executed state and re-arms
//! it). Re-fund via `deposit` and re-set beneficiaries via `update_intent` (on the PER after
//! re-delegation). Owner-only.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::{BeneficiarySet, IntentCapsule};

#[derive(Accounts)]
pub struct RecreateCapsule<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump = capsule.bump,
        constraint = capsule.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    /// Reset alongside the Switch. Must be back on base (undelegated) - same as the Switch after a
    /// completed distribution. Re-delegate + re-set beneficiaries via update_intent to re-arm privacy.
    #[account(
        mut,
        seeds = [b"beneficiary_set", owner.key().as_ref()],
        bump = beneficiary_set.bump,
        constraint = beneficiary_set.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub beneficiary_set: Box<Account<'info, BeneficiarySet>>,

    pub owner: Signer<'info>,
}

/// Reset an executed capsule with a new inactivity period and a fresh (empty) lifecycle. Owner-only.
pub fn handler(ctx: Context<RecreateCapsule>, inactivity_period: i64) -> Result<()> {
    require!(inactivity_period > 0, ErrorCode::InvalidInactivityPeriod);

    let capsule = &mut ctx.accounts.capsule;
    // Only reuse a capsule that has already fired (lifecycle reset after distribution).
    require!(!capsule.is_active, ErrorCode::CapsuleActive);
    require!(capsule.executed_at.is_some(), ErrorCode::CapsuleNotExecuted);

    capsule.inactivity_period = inactivity_period;
    capsule.last_activity = Clock::get()?.unix_timestamp;
    capsule.is_active = true;
    capsule.executed_at = None;

    ctx.accounts.beneficiary_set.beneficiaries = Vec::new();

    msg!("Capsule lifecycle reset (recreate) for owner: {:?}", capsule.owner);
    Ok(())
}

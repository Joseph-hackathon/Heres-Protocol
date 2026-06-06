//! Update the capsule's last-activity timestamp (owner-driven keep-alive).

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::IntentCapsule;

#[derive(Accounts)]
pub struct UpdateActivity<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    pub owner: Signer<'info>,
}

/// Update last activity timestamp (called by Helius webhook or user).
pub fn handler(ctx: Context<UpdateActivity>) -> Result<()> {
    let capsule = &mut ctx.accounts.capsule;
    require!(capsule.owner == ctx.accounts.owner.key(), ErrorCode::Unauthorized);

    capsule.last_activity = Clock::get()?.unix_timestamp;

    msg!("Activity updated for capsule: {:?}", capsule.key());
    Ok(())
}

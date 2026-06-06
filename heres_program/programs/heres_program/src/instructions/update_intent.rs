//! Update the intent data of an existing capsule (owner only).

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::IntentCapsule;

#[derive(Accounts)]
pub struct UpdateIntent<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    pub owner: Signer<'info>,
}

/// Update the intent data of an existing capsule.
pub fn handler(ctx: Context<UpdateIntent>, new_intent_data: Vec<u8>) -> Result<()> {
    let capsule = &mut ctx.accounts.capsule;
    require!(capsule.owner == ctx.accounts.owner.key(), ErrorCode::Unauthorized);
    require!(capsule.is_active, ErrorCode::CapsuleInactive);

    capsule.intent_data = new_intent_data;
    capsule.last_activity = Clock::get()?.unix_timestamp;

    msg!("Intent updated for capsule: {:?}", capsule.key());
    Ok(())
}

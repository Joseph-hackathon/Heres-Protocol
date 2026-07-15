//! Arm a sealed draft Switch on the regular ER.
//!
//! The commitment was calculated and sealed inside the TEE first. Once stored here, execute_intent
//! freezes this exact settlement configuration even though distribution resumes across later
//! base-layer transactions.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::IntentCapsule;

#[derive(Accounts)]
pub struct ArmCapsule<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump = capsule.bump,
        constraint = capsule.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    pub owner: Signer<'info>,
}

pub fn handler(ctx: Context<ArmCapsule>, config_commitment: [u8; 32]) -> Result<()> {
    let capsule = &mut ctx.accounts.capsule;
    require!(
        capsule.requires_config_commitment(),
        ErrorCode::InvalidInstructionData
    );
    require!(
        !capsule.is_active && capsule.executed_at.is_none(),
        ErrorCode::CapsuleNotDraft
    );
    require!(
        config_commitment != [0u8; 32],
        ErrorCode::InvalidConfigurationCommitment
    );

    let now = Clock::get()?.unix_timestamp;
    if let Some(target_date) = capsule.target_date {
        require!(target_date > now, ErrorCode::InvalidTargetDate);
    }
    capsule.set_config_commitment(config_commitment);
    capsule.last_activity = now;
    capsule.is_active = true;

    msg!("Capsule armed with sealed inheritance: {:?}", capsule.key());
    Ok(())
}

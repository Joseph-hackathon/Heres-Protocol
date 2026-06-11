//! Set or replace the capsule's private beneficiary list (owner only).
//!
//! PRIVACY (redesign D8): the client must route this through the PER after delegation, so the
//! beneficiary list lives in the TEE while the owner is alive. Writing beneficiaries via a
//! base-layer tx would put them in public history forever.

use anchor_lang::prelude::*;

use crate::constants::{BPS_DENOMINATOR, MAX_BENEFICIARIES};
use crate::error::ErrorCode;
use crate::state::{Beneficiary, IntentCapsule};

#[derive(Accounts)]
pub struct UpdateIntent<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump = capsule.bump,
        constraint = capsule.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    pub owner: Signer<'info>,
}

/// Replace the beneficiary list. Shares must sum to exactly 10000 bps (100%) and fit the cap.
pub fn handler(ctx: Context<UpdateIntent>, beneficiaries: Vec<Beneficiary>) -> Result<()> {
    let capsule = &mut ctx.accounts.capsule;
    require!(capsule.is_active, ErrorCode::CapsuleInactive);
    require!(!beneficiaries.is_empty(), ErrorCode::NoBeneficiaries);
    require!(beneficiaries.len() <= MAX_BENEFICIARIES, ErrorCode::TooManyBeneficiaries);

    let mut sum: u32 = 0;
    for b in &beneficiaries {
        require!(b.pubkey != Pubkey::default(), ErrorCode::InvalidBeneficiaryAddress);
        sum = sum.checked_add(b.share_bps as u32).ok_or(ErrorCode::InvalidShareSum)?;
    }
    require!(sum == BPS_DENOMINATOR as u32, ErrorCode::InvalidShareSum);

    capsule.beneficiaries = beneficiaries;
    capsule.last_activity = Clock::get()?.unix_timestamp;

    msg!(
        "Beneficiaries updated ({} entries) for capsule {:?}",
        capsule.beneficiaries.len(),
        capsule.key()
    );
    Ok(())
}

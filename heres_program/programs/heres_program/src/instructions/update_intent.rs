//! Set or replace the owner's private beneficiary list (owner only).
//!
//! PRIVACY (redesign D8): the client must route this through the TEE after the BeneficiarySet is
//! delegated, so the list lives in the enclave while the owner is alive. Writing beneficiaries via a
//! base-layer tx would put them in public history forever.
//!
//! This touches ONLY the BeneficiarySet (TEE) - never the Switch. Liveness is proven separately by
//! wallet activity / heartbeats on the regular-ER Switch, so there is no last_activity bump here (the
//! two accounts live on different ERs and cannot be co-written). We also cannot read the Switch's
//! is_active cross-ER, so edits are gated by owner signature alone; a fired capsule's set is about to
//! be revealed for distribution anyway, and only the owner can ever reach this.

use anchor_lang::prelude::*;

use crate::constants::{BPS_DENOMINATOR, MAX_BENEFICIARIES};
use crate::error::ErrorCode;
use crate::state::{Beneficiary, BeneficiarySet};

#[derive(Accounts)]
pub struct UpdateIntent<'info> {
    #[account(
        mut,
        seeds = [b"beneficiary_set", owner.key().as_ref()],
        bump = beneficiary_set.bump,
        constraint = beneficiary_set.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub beneficiary_set: Box<Account<'info, BeneficiarySet>>,

    pub owner: Signer<'info>,
}

/// Replace the beneficiary list. Shares must sum to exactly 10000 bps (100%) and fit the cap.
pub fn handler(ctx: Context<UpdateIntent>, beneficiaries: Vec<Beneficiary>) -> Result<()> {
    require!(!beneficiaries.is_empty(), ErrorCode::NoBeneficiaries);
    require!(beneficiaries.len() <= MAX_BENEFICIARIES, ErrorCode::TooManyBeneficiaries);

    let mut sum: u32 = 0;
    for b in &beneficiaries {
        require!(b.pubkey != Pubkey::default(), ErrorCode::InvalidBeneficiaryAddress);
        sum = sum.checked_add(b.share_bps as u32).ok_or(ErrorCode::InvalidShareSum)?;
    }
    require!(sum == BPS_DENOMINATOR as u32, ErrorCode::InvalidShareSum);

    let beneficiary_set = &mut ctx.accounts.beneficiary_set;
    beneficiary_set.beneficiaries = beneficiaries;

    msg!(
        "Beneficiaries updated ({} entries) for owner {:?}",
        beneficiary_set.beneficiaries.len(),
        beneficiary_set.owner
    );
    Ok(())
}

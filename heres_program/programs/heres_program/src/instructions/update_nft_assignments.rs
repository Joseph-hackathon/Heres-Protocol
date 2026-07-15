//! Set or replace private per-NFT recipients (owner only).
//!
//! The client routes this instruction through the TEE after BeneficiarySet delegation. Keeping the
//! assignments beside proportional beneficiaries preserves the same Tier-1 privacy boundary: mint
//! ownership remains public in the base Vault, but the intended recipient is hidden while alive.

use anchor_lang::prelude::*;
use std::collections::BTreeSet;

use crate::constants::MAX_NFT_ASSIGNMENTS;
use crate::error::ErrorCode;
use crate::state::{BeneficiarySet, NftAssignment};

#[derive(Accounts)]
pub struct UpdateNftAssignments<'info> {
    #[account(
        mut,
        seeds = [b"beneficiary_set", owner.key().as_ref()],
        bump = beneficiary_set.bump,
        constraint = beneficiary_set.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub beneficiary_set: Box<Account<'info, BeneficiarySet>>,

    pub owner: Signer<'info>,
}

pub fn handler(ctx: Context<UpdateNftAssignments>, assignments: Vec<NftAssignment>) -> Result<()> {
    require!(!assignments.is_empty(), ErrorCode::InvalidNftAssignment);
    require!(
        assignments.len() <= MAX_NFT_ASSIGNMENTS,
        ErrorCode::TooManyNftAssignments
    );

    let mut seen = BTreeSet::new();
    for assignment in &assignments {
        require!(
            assignment.mint != Pubkey::default() && assignment.recipient != Pubkey::default(),
            ErrorCode::InvalidNftAssignment
        );
        require!(
            seen.insert(assignment.mint),
            ErrorCode::DuplicateNftAssignment
        );
    }

    ctx.accounts.beneficiary_set.nft_assignments = assignments;
    msg!(
        "NFT assignments updated ({} entries) for owner {:?}",
        ctx.accounts.beneficiary_set.nft_assignments.len(),
        ctx.accounts.beneficiary_set.owner
    );
    Ok(())
}

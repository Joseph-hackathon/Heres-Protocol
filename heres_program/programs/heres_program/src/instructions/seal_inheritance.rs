//! Seal the private settlement configuration inside the TEE.
//!
//! The client sends update_intent, optional update_nft_assignments, and this instruction in one TEE
//! transaction. The seal stores a private salt and rejects every later configuration edit. The
//! resulting commitment is then copied to the regular-ER Switch by arm_capsule.

use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::BeneficiarySet;

#[derive(Accounts)]
pub struct SealInheritance<'info> {
    #[account(
        mut,
        seeds = [b"beneficiary_set", owner.key().as_ref()],
        bump = beneficiary_set.bump,
        constraint = beneficiary_set.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub beneficiary_set: Box<Account<'info, BeneficiarySet>>,

    pub owner: Signer<'info>,
}

pub fn handler(
    ctx: Context<SealInheritance>,
    salt: [u8; 32],
    expected_commitment: [u8; 32],
) -> Result<()> {
    let beneficiary_set = &mut ctx.accounts.beneficiary_set;
    require!(
        beneficiary_set.requires_seal(),
        ErrorCode::InvalidInstructionData
    );
    require!(
        !beneficiary_set.is_sealed(),
        ErrorCode::InheritanceAlreadySealed
    );
    require!(
        !beneficiary_set.beneficiaries.is_empty(),
        ErrorCode::NoBeneficiaries
    );
    require!(
        expected_commitment != [0u8; 32],
        ErrorCode::InvalidConfigurationCommitment
    );
    require!(salt != [0u8; 32], ErrorCode::InvalidConfigurationCommitment);

    beneficiary_set.seal(salt);
    require!(
        beneficiary_set.config_commitment() == expected_commitment,
        ErrorCode::InvalidConfigurationCommitment
    );

    msg!(
        "Inheritance configuration sealed for owner {:?}",
        beneficiary_set.owner
    );
    Ok(())
}

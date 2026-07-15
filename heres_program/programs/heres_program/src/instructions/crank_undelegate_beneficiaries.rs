//! Commit the BeneficiarySet's TEE state and undelegate it - plus its PER permission - back to base.
//! This is the privacy REVEAL: once on base, the beneficiary list is public, enabling distribution.
//!
//! Cross-ER gate (Workstream A): the BeneficiarySet (TEE) cannot read the Switch's liveness, which
//! lives on a *different* (regular) ER. So we permit the reveal only when EITHER:
//!   - the owner is undelegating their own set (alive, e.g. to cancel/edit), OR
//!   - the Switch has fired AND already been committed back to base (program-owned + is_active=false +
//!     executed_at set), bound to the same owner.
//! The off-chain crank therefore MUST undelegate the Switch first (crank_undelegate), let it settle to
//! base, then call this - at which point the Switch is readable here as a plain base account.
//!
//! Signs as the BeneficiarySet PDA for the permission release (the permission program accepts either
//! the authority OR the permissioned account), so no living owner / AUTHORITY member is needed - the
//! dead-man path settles autonomously. The crank stays a signer so its outer-tx signature propagates
//! into the permission program's magic-context CPI (else PrivilegeEscalation on the payer).

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CommitAndUndelegatePermissionCpiBuilder;
use ephemeral_rollups_sdk::access_control::structs::PERMISSION_SEED;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::constants::PERMISSION_PROGRAM_ID;
use crate::error::ErrorCode;
use crate::state::{BeneficiarySet, IntentCapsule};

#[commit]
#[derive(Accounts)]
pub struct CrankUndelegateBeneficiariesInput<'info> {
    /// Anyone can call this once the switch has fired (crank wallet); or the owner, to reveal early.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: owner pubkey - used to derive the BeneficiarySet + Switch PDAs and sign as the set. NOT a signer.
    pub owner: AccountInfo<'info>,
    /// CHECK: the BeneficiarySet PDA (delegated to the TEE, will be undelegated). Seeds [b"beneficiary_set", owner].
    #[account(mut, seeds = [b"beneficiary_set", owner.key().as_ref()], bump)]
    pub beneficiary_set: AccountInfo<'info>,
    /// CHECK: the Switch PDA, read-only, consulted ONLY for the fired-check. Must already be back on
    /// base (program-owned) for the dead-man path. Seeds [b"intent_capsule", owner].
    #[account(seeds = [b"intent_capsule", owner.key().as_ref()], bump)]
    pub switch: AccountInfo<'info>,
    /// CHECK: permission PDA [b"permission:", beneficiary_set] under the permission program.
    #[account(
        mut,
        seeds = [PERMISSION_SEED, beneficiary_set.key().as_ref()],
        bump,
        seeds::program = permission_program.key()
    )]
    pub permission: AccountInfo<'info>,
    /// CHECK: MagicBlock Permission Program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
}

/// Commit + undelegate the PER permission, then the BeneficiarySet, back to the base layer.
pub fn handler(ctx: Context<CrankUndelegateBeneficiariesInput>) -> Result<()> {
    let owner_key = ctx.accounts.owner.key();
    let set_bump = ctx.bumps.beneficiary_set;
    let set_seeds: &[&[u8]] = &[b"beneficiary_set", owner_key.as_ref(), &[set_bump]];

    // Gate the reveal. The BeneficiarySet is ER-resident here (program-owned), so we can read its
    // owner; the Switch is consulted only when it is program-owned (= already undelegated to base).
    {
        let set_data = ctx.accounts.beneficiary_set.try_borrow_data()?;
        let set = BeneficiarySet::try_deserialize(&mut &set_data[..])?;
        let owner_undelegating = ctx.accounts.payer.key() == set.owner;

        let fired = if ctx.accounts.switch.owner == &crate::ID {
            let sw_data = ctx.accounts.switch.try_borrow_data()?;
            let cap = IntentCapsule::try_deserialize(&mut &sw_data[..])?;
            let fired = !cap.is_active && cap.executed_at.is_some() && cap.owner == set.owner;
            if fired && cap.requires_config_commitment() {
                require!(
                    set.requires_seal() && set.is_sealed(),
                    ErrorCode::InheritanceNotSealed
                );
                require!(
                    cap.config_commitment() == set.config_commitment(),
                    ErrorCode::InvalidConfigurationCommitment
                );
            }
            fired
        } else {
            // Switch still delegated elsewhere (or absent) => cannot prove a fire => no permissionless reveal.
            false
        };
        require!(owner_undelegating || fired, ErrorCode::CapsuleActive);
    }

    msg!("Crank undelegating BeneficiarySet + PER permission from TEE (privacy reveal)");

    // 1. Commit + undelegate the permission account, signing as the BeneficiarySet PDA.
    let magic_program = ctx.accounts.magic_program.to_account_info();
    let magic_context = ctx.accounts.magic_context.to_account_info();
    CommitAndUndelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
        .authority(&ctx.accounts.payer.to_account_info(), true)
        .permissioned_account(&ctx.accounts.beneficiary_set, true)
        .permission(&ctx.accounts.permission)
        .magic_program(&magic_program)
        .magic_context(&magic_context)
        .invoke_signed(&[set_seeds])?;

    // 2. Commit + undelegate the BeneficiarySet itself.
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        magic_context,
        magic_program,
    )
    .commit_and_undelegate(&[ctx.accounts.beneficiary_set.to_account_info()])
    .build_and_invoke()?;
    msg!("BeneficiarySet + permission commit+undelegate scheduled");
    Ok(())
}

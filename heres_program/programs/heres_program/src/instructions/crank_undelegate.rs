//! Commit the Switch's ER state and undelegate it back to base (crank). Switch side only.
//!
//! The Switch lives on a regular ER and has NO PER permission, so this is a plain commit+undelegate -
//! no permission lifecycle (that belongs to the BeneficiarySet, see crank_undelegate_beneficiaries).
//!
//! Gated owner-OR-fired, even though the Switch carries nothing private: an ungated undelegate would
//! let anyone yank a LIVE owner's Switch back to base, which stops the autonomous ScheduleTask from
//! firing it (the task only runs while the account is ER-resident) - a DoS on the dead-man's switch.
//! The check reads the Switch on the ER, where it is program-owned and therefore deserializable.
//!
//! Permissionless once fired: the crank wallet signs as payer; `owner` is passed only to derive the
//! Switch PDA. The off-chain pipeline calls this AFTER the Switch has fired, then sequences
//! crank_undelegate_beneficiaries (which depends on this Switch being back on base).

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::error::ErrorCode;
use crate::state::IntentCapsule;

#[commit]
#[derive(Accounts)]
pub struct CrankUndelegateInput<'info> {
    /// Anyone can call this (crank wallet).
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: owner pubkey - only used to derive the Switch PDA. NOT a signer.
    pub owner: AccountInfo<'info>,
    /// CHECK: the Switch PDA (delegated to the regular ER, will be undelegated). Seeds [b"intent_capsule", owner].
    #[account(mut, seeds = [b"intent_capsule", owner.key().as_ref()], bump)]
    pub capsule: AccountInfo<'info>,
}

/// Commit + undelegate the Switch back to the base layer.
pub fn handler(ctx: Context<CrankUndelegateInput>) -> Result<()> {
    // Permit only when the owner undelegates their own Switch, or the switch has already fired.
    {
        let data = ctx.accounts.capsule.try_borrow_data()?;
        let cap = IntentCapsule::try_deserialize(&mut &data[..])?;
        let owner_undelegating = ctx.accounts.payer.key() == cap.owner;
        let fired = !cap.is_active && cap.executed_at.is_some();
        require!(owner_undelegating || fired, ErrorCode::CapsuleActive);
    }

    msg!("Crank undelegating Switch from regular ER");
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.capsule.to_account_info()])
    .build_and_invoke()?;
    msg!("Switch commit+undelegate scheduled");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instructions::crank_undelegate_beneficiaries::CrankUndelegateBeneficiariesInput;
    use crate::instructions::delegate_beneficiaries::DelegateBeneficiariesInput;
    use crate::instructions::delegate_capsule::DelegateCapsuleInput;
    use ephemeral_rollups_sdk::anchor::{DelegationProgram, MagicProgram};

    // Compile-time regression guard: changing any security-sensitive program field back to a raw
    // AccountInfo makes this helper fail to compile.
    #[allow(dead_code)]
    fn assert_program_accounts_are_typed(
        crank: &CrankUndelegateInput<'_>,
        beneficiary_crank: &CrankUndelegateBeneficiariesInput<'_>,
        delegate_capsule: &DelegateCapsuleInput<'_>,
        delegate_beneficiaries: &DelegateBeneficiariesInput<'_>,
    ) {
        let _: &Program<'_, MagicProgram> = &crank.magic_program;
        let _: &Program<'_, MagicProgram> = &beneficiary_crank.magic_program;
        let _: &Program<'_, MagicProgram> = &delegate_capsule.magic_program;
        let _: &Program<'_, DelegationProgram> = &delegate_capsule.delegation_program;
        let _: &Program<'_, MagicProgram> = &delegate_beneficiaries.magic_program;
        let _: &Program<'_, DelegationProgram> = &delegate_beneficiaries.delegation_program;
    }

    #[test]
    fn rejects_substituted_magic_program() {
        let wrong_key = system_program::ID;
        let owner = system_program::ID;
        let mut lamports = 0;
        let mut data = [];
        let account = AccountInfo::new(
            &wrong_key,
            false,
            false,
            &mut lamports,
            &mut data,
            &owner,
            true,
            0,
        );

        let error = match Program::<MagicProgram>::try_from(&account) {
            Ok(_) => panic!("substituted Magic program was accepted"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("InvalidProgramId"));
    }
}

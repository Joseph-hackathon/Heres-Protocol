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

use crate::error::ErrorCode;
use crate::state::IntentCapsule;

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
    /// CHECK: MagicBlock Magic Context.
    #[account(mut)]
    pub magic_context: AccountInfo<'info>,
    /// CHECK: MagicBlock Magic Program.
    pub magic_program: AccountInfo<'info>,
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
    ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts(
        &ctx.accounts.payer.to_account_info(),
        vec![&ctx.accounts.capsule.to_account_info()],
        &ctx.accounts.magic_context.to_account_info(),
        &ctx.accounts.magic_program.to_account_info(),
        None, // magic_fee_vault: no commit sponsorship configured
    )?;
    msg!("Switch commit+undelegate scheduled");
    Ok(())
}

//! Commit the Switch's ER state and undelegate it - plus its PER permission - back to base (crank).
//!
//! Permissionless: the crank wallet signs as payer. For the permission release we sign as the Switch
//! PDA itself (the permission program accepts EITHER the authority OR the permissioned account as the
//! signer), so NO living owner and NO AUTHORITY member is required - the program is the authority.
//! That is what lets the dead-man's-switch settle autonomously after the owner is gone.
//!
//! The off-chain pipeline calls this only after the Switch has fired - the conditional check is kept
//! off-chain because a delegated AccountInfo can't be deserialized to read executed_at (audit M5).
//! `owner` is passed only to derive the Switch PDA + sign as it; it is never a signer here.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CommitAndUndelegatePermissionCpiBuilder;

use crate::constants::PERMISSION_PROGRAM_ID;
use crate::error::ErrorCode;
use crate::state::IntentCapsule;

#[derive(Accounts)]
pub struct CrankUndelegateInput<'info> {
    /// Anyone can call this (crank wallet).
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: owner pubkey - only used to derive the Switch PDA and sign as it. NOT a signer.
    pub owner: AccountInfo<'info>,
    /// CHECK: the Switch PDA (delegated to ER, will be undelegated). Seeds [b"intent_capsule", owner].
    #[account(mut, seeds = [b"intent_capsule", owner.key().as_ref()], bump)]
    pub capsule: AccountInfo<'info>,
    /// CHECK: permission PDA [b"permission:", capsule] under the permission program.
    #[account(mut)]
    pub permission: AccountInfo<'info>,
    /// CHECK: MagicBlock Permission Program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
    /// CHECK: MagicBlock Magic Context.
    #[account(mut)]
    pub magic_context: AccountInfo<'info>,
    /// CHECK: MagicBlock Magic Program.
    pub magic_program: AccountInfo<'info>,
}

/// Commit + undelegate the PER permission, then the Switch, back to the base layer.
pub fn handler(ctx: Context<CrankUndelegateInput>) -> Result<()> {
    let owner_key = ctx.accounts.owner.key();
    let capsule_bump = ctx.bumps.capsule;
    let capsule_seeds: &[&[u8]] = &[b"intent_capsule", owner_key.as_ref(), &[capsule_bump]];

    // Undelegation COMMITS the Switch - including the private beneficiary list - back to the public
    // base layer. Permit it only when EITHER the owner is undelegating their own Switch, OR the
    // switch has already fired. This stops any third party from force-committing a live owner's
    // private beneficiaries to base (Tier-1 privacy: private while alive, public at payout). This
    // runs on the ER, where the Switch is program-owned and therefore readable.
    {
        let data = ctx.accounts.capsule.try_borrow_data()?;
        let cap = IntentCapsule::try_deserialize(&mut &data[..])?;
        let owner_undelegating = ctx.accounts.payer.key() == cap.owner;
        let fired = !cap.is_active && cap.executed_at.is_some();
        require!(owner_undelegating || fired, ErrorCode::CapsuleActive);
    }

    msg!("Crank undelegating Switch + PER permission from ER");

    // 1. Commit + undelegate the permission account. Authorization comes from the Switch PDA signing
    //    as permissioned_account (via invoke_signed), so the crank need not be a permission member.
    //    The crank (payer) is still marked signer so its outer-tx signature propagates into the
    //    permission program's downstream magic-context CPI (else: PrivilegeEscalation on the payer).
    CommitAndUndelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
        .authority(&ctx.accounts.payer.to_account_info(), true)
        .permissioned_account(&ctx.accounts.capsule, true)
        .permission(&ctx.accounts.permission)
        .magic_program(&ctx.accounts.magic_program)
        .magic_context(&ctx.accounts.magic_context)
        .invoke_signed(&[capsule_seeds])?;

    // 2. Commit + undelegate the Switch itself.
    ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts(
        &ctx.accounts.payer.to_account_info(),
        vec![&ctx.accounts.capsule.to_account_info()],
        &ctx.accounts.magic_context.to_account_info(),
        &ctx.accounts.magic_program.to_account_info(),
        None, // magic_fee_vault: no commit sponsorship configured
    )?;
    msg!("Switch + permission commit+undelegate scheduled");
    Ok(())
}

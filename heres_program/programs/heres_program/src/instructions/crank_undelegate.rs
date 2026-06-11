//! Commit the Switch's ER state and undelegate it back to the base layer (crank-callable).
//!
//! Only the Switch is delegated, so only it is undelegated here. Permissionless (the crank wallet
//! signs as payer). The off-chain pipeline calls this only after the Switch has fired - the
//! conditional check is kept off-chain because a delegated AccountInfo can't be deserialized to
//! read executed_at on-chain (audit M5).

use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CrankUndelegateInput<'info> {
    /// Anyone can call this (crank wallet).
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the Switch PDA (delegated to ER, will be undelegated).
    #[account(mut)]
    pub capsule: AccountInfo<'info>,
    /// CHECK: MagicBlock Magic Context.
    #[account(mut)]
    pub magic_context: AccountInfo<'info>,
    /// CHECK: MagicBlock Magic Program.
    pub magic_program: AccountInfo<'info>,
}

/// Commit the Switch's state from the ER and undelegate it back to the base layer.
pub fn handler(ctx: Context<CrankUndelegateInput>) -> Result<()> {
    msg!("Crank undelegating Switch from ER");
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

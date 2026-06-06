//! Commit ER state and undelegate the capsule + vault back to the base layer (crank-callable).

use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CrankUndelegateInput<'info> {
    /// Anyone can call this (crank wallet)
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Capsule PDA (delegated to ER, will be undelegated)
    #[account(mut)]
    pub capsule: AccountInfo<'info>,
    /// CHECK: Vault PDA (delegated to ER, will be undelegated)
    #[account(mut)]
    pub vault: AccountInfo<'info>,
    /// CHECK: MagicBlock Magic Context
    #[account(mut)]
    pub magic_context: AccountInfo<'info>,
    /// CHECK: MagicBlock Magic Program
    pub magic_program: AccountInfo<'info>,
}

/// Commit state from ER and undelegate capsule + vault back to base layer.
/// This is a separate instruction from execute_intent to avoid ExternalAccountDataModified.
/// Anyone (crank) can call this — no owner signature required.
pub fn handler(ctx: Context<CrankUndelegateInput>) -> Result<()> {
    msg!("Crank undelegating capsule and vault from ER");

    let capsule_info = ctx.accounts.capsule.to_account_info();
    let vault_info = ctx.accounts.vault.to_account_info();
    let payer_info = ctx.accounts.payer.to_account_info();
    let magic_context_info = ctx.accounts.magic_context.to_account_info();
    let magic_program_info = ctx.accounts.magic_program.to_account_info();

    // CPI to Magic program: commit_and_undelegate for both capsule and vault.
    // Because this is CPI from our program, Magic program can identify parent program ID.
    // No state changes are made by our program, so ExternalAccountDataModified won't occur.
    ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts(
        &payer_info,
        vec![&capsule_info, &vault_info],
        &magic_context_info,
        &magic_program_info,
        None, // magic_fee_vault: no commit sponsorship configured
    )?;

    msg!("Capsule and Vault commit+undelegate scheduled");
    Ok(())
}

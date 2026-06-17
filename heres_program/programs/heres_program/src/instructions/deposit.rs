//! Lock SOL or SPL into the Vault. Repeatable - the Vault holds native SOL plus one ATA per mint,
//! so multi-asset inheritance is just multiple deposits. The Vault stays on the base layer the
//! whole time (never delegated), so deposits work regardless of the Switch's delegation state.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::ErrorCode;
use crate::state::{CapsuleVault, IntentCapsule};

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// CHECK: the Switch PDA, validated by seeds. Read as a raw AccountInfo (NOT
    /// Account<IntentCapsule>) on purpose: while the Switch is delegated its owner is the delegation
    /// program, so an Account<IntentCapsule> would fail Anchor's owner check (error 3007) - yet the
    /// Vault is always on the base layer, so deposits must keep working in that state (same pattern as
    /// recover_vault). Authorization is the owner signer + the owner-seeded capsule/vault PDAs;
    /// is_active is enforced in the handler only when the Switch is base-resident (program-owned).
    #[account(seeds = [b"intent_capsule", owner.key().as_ref()], bump)]
    pub capsule: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"capsule_vault", owner.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, CapsuleVault>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,

    // SPL deposit path (all optional; omit for native SOL). Interface types accept both the classic
    // SPL Token program and Token-2022; the ATA is bound to whichever token program is passed.
    pub token_program: Option<Interface<'info, TokenInterface>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
    pub mint: Option<Box<InterfaceAccount<'info, Mint>>>,
    #[account(mut)]
    pub source_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
}

/// Lock `amount` of an asset into the Vault. Owner only; capsule must be active.
pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    // The Vault is never delegated, so deposits run on base regardless of the Switch's delegation
    // state. Only consult is_active when the Switch is base-resident (program-owned); when it is
    // delegated we cannot deserialize the stub here, and the owner signer + owner-seeded PDAs already
    // authorize the deposit. Mirrors recover_vault's escape-hatch handling.
    let cap_ai = &ctx.accounts.capsule;
    if cap_ai.owner == &crate::ID {
        let data = cap_ai.try_borrow_data()?;
        let cap = IntentCapsule::try_deserialize(&mut &data[..])?;
        require!(cap.is_active, ErrorCode::CapsuleInactive);
    }

    if let Some(mint) = &ctx.accounts.mint {
        let from_ata = ctx.accounts.source_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        let to_ata = ctx.accounts.vault_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        let token_program = ctx.accounts.token_program.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        require!(to_ata.mint == mint.key(), ErrorCode::InvalidTokenAccount);

        // transfer_checked (mint + decimals) is required by Token-2022 and supported by classic SPL.
        let cpi_accounts = TransferChecked {
            from: from_ata.to_account_info(),
            mint: mint.to_account_info(),
            to: to_ata.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        token_interface::transfer_checked(
            CpiContext::new(token_program.to_account_info(), cpi_accounts),
            amount,
            mint.decimals,
        )?;
        msg!("Deposited {} of mint {:?} into vault", amount, mint.key());
    } else {
        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts),
            amount,
        )?;
        msg!("Deposited {} lamports into vault", amount);
    }
    Ok(())
}

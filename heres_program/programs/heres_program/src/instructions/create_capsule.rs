//! Create a new Intent Capsule and lock SOL or SPL assets into its vault.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::state::{CapsuleVault, FeeConfig, IntentCapsule};
use crate::utils::{infer_asset_decimals, parse_amount_to_units};

#[derive(Accounts)]
pub struct CreateCapsule<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + IntentCapsule::LEN,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    #[account(
        init,
        payer = owner,
        space = 8 + CapsuleVault::LEN,
        seeds = [b"capsule_vault", owner.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, CapsuleVault>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [b"fee_config"], bump)]
    pub fee_config: Box<Account<'info, FeeConfig>>,

    /// Platform fee recipient (must match fee_config.fee_recipient when creation_fee_lamports > 0)
    /// CHECK: validated against fee_config.fee_recipient in instruction
    #[account(mut)]
    pub platform_fee_recipient: Option<AccountInfo<'info>>,

    pub system_program: Program<'info, System>,

    pub token_program: Program<'info, Token>,

    pub mint: Option<Box<Account<'info, Mint>>>,

    #[account(mut)]
    pub source_token_account: Option<Box<Account<'info, TokenAccount>>>,

    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = vault,
    )]
    pub vault_token_account: Option<Box<Account<'info, TokenAccount>>>,

    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Initialize a new Intent Capsule (SOL locked in vault; anyone can execute when conditions are met).
/// PER: Uses Magicblock Permission Program to restrict intent_data access to TEE validator and Owner only.
pub fn handler(
    ctx: Context<CreateCapsule>,
    inactivity_period: i64,
    intent_data: Vec<u8>,
) -> Result<()> {
    // A non-positive inactivity period would make the capsule instantly executable by anyone (audit M3).
    require!(inactivity_period > 0, ErrorCode::InvalidInactivityPeriod);

    // Parse totalAmount from intent_data
    let total_amount_units = {
        let intent_data_str = String::from_utf8(intent_data.clone())
            .map_err(|_| ErrorCode::InvalidIntentData)?;
        let intent_json: serde_json::Value = serde_json::from_str(&intent_data_str)
            .map_err(|_| ErrorCode::InvalidIntentData)?;
        let total_str = intent_json
            .get("totalAmount")
            .and_then(|t| t.as_str())
            .ok_or(ErrorCode::InvalidIntentData)?;
        let asset_decimals =
            infer_asset_decimals(&intent_json, ctx.accounts.mint.as_ref().map(|mint| mint.decimals));
        parse_amount_to_units(total_str, asset_decimals).map_err(|_| ErrorCode::InvalidIntentData)?
    };

    let fee_config = &ctx.accounts.fee_config;
    if fee_config.creation_fee_lamports > 0 {
        let platform_recipient = ctx
            .accounts
            .platform_fee_recipient
            .as_mut()
            .ok_or(ErrorCode::InvalidFeeConfig)?;
        // Ensure the recipient matches the one provided in the config
        require!(platform_recipient.key() == fee_config.fee_recipient, ErrorCode::InvalidFeeConfig);

        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to: platform_recipient.clone(),
        };
        let cpi_program = ctx.accounts.system_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        system_program::transfer(cpi_ctx, fee_config.creation_fee_lamports)?;
        msg!(
            "Creation fee {} lamports sent to platform recipient: {:?}",
            fee_config.creation_fee_lamports,
            platform_recipient.key()
        );
    }

    let capsule = &mut ctx.accounts.capsule;
    capsule.owner = ctx.accounts.owner.key();
    capsule.inactivity_period = inactivity_period;
    capsule.last_activity = Clock::get()?.unix_timestamp;
    capsule.intent_data = intent_data;
    capsule.is_active = true;
    capsule.bump = ctx.bumps.capsule;
    capsule.vault_bump = ctx.bumps.vault;
    // Record the REAL amount locked into the vault. All later distribution math is driven by this,
    // not the owner-asserted intent_data.totalAmount which update_intent could desync (audit H4).
    capsule.locked_amount = total_amount_units;

    // Check if SPL Mint is provided
    if let Some(mint) = &ctx.accounts.mint {
        capsule.mint = mint.key();
        let from_ata = ctx.accounts.source_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        let to_ata = ctx.accounts.vault_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;

        // Transfer SPL tokens
        let cpi_accounts = Transfer {
            from: from_ata.to_account_info(),
            to: to_ata.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, total_amount_units)?;
        msg!("Locked {} tokens in vault for capsule {:?}", total_amount_units, capsule.key());
    } else {
        capsule.mint = Pubkey::default(); // default to 0000... (SystemProgram-like behavior)

        // Lock SOL in vault
        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.system_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        system_program::transfer(cpi_ctx, total_amount_units)?;
        msg!("Locked {} lamports in vault for capsule {:?}", total_amount_units, capsule.key());
    }

    msg!("Intent Capsule created: {:?}", ctx.accounts.capsule.key());
    Ok(())
}

//! Private distribution path: move remaining vault funds to the distributor (crank/cron driven).

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::state::{CapsuleDistribution, CapsuleVault, DistributorConfig, FeeConfig, IntentCapsule};
use crate::utils::{infer_asset_decimals, parse_amount_to_units, wants_private_distribution};

#[derive(Accounts)]
pub struct PreparePrivateDistribution<'info> {
    #[account(
        mut, // handler sets private_distributed = true; must persist (idempotency)
        seeds = [b"intent_capsule", capsule.owner.as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    #[account(
        mut,
        seeds = [b"capsule_vault", capsule.owner.as_ref()],
        bump = capsule.vault_bump
    )]
    pub vault: Box<Account<'info, CapsuleVault>>,

    #[account(seeds = [b"fee_config"], bump)]
    pub fee_config: Box<Account<'info, FeeConfig>>,

    /// Pins the relayer the vault funds may move to. Admin-settable via `configure_distributor`,
    /// decoupled from the fee admin so the hot relayer key can differ and rotate (Option B).
    #[account(seeds = [b"distributor_config"], bump)]
    pub distributor_config: Box<Account<'info, DistributorConfig>>,

    /// Platform fee recipient (SPL ATA for SPL, wallet for SOL)
    #[account(mut)]
    pub platform_fee_recipient: Option<AccountInfo<'info>>,

    pub mint: Option<Box<Account<'info, Mint>>>,

    #[account(mut)]
    pub vault_token_account: Option<Box<Account<'info, TokenAccount>>>,

    /// The distributor's token account (SPL) receiving the remaining funds
    #[account(mut)]
    pub distributor_token_account: Option<AccountInfo<'info>>,

    /// The protocol distributor relayer (Option B). Funds move here only transiently before the
    /// off-chain MagicBlock Private Payments leg fans them out privately to each beneficiary.
    /// Pinned to the admin-configured `distributor_config.distributor` so it CANNOT be an
    /// arbitrary caller draining the vault (audit C1), while still allowing the relayer to be a
    /// dedicated, rotatable wallet distinct from the fee admin.
    #[account(mut, constraint = distributor.key() == distributor_config.distributor @ ErrorCode::InvalidDistributor)]
    pub distributor: Signer<'info>,

    pub token_program: Option<Program<'info, Token>>,

    pub system_program: Program<'info, System>,

    /// Distribution state PDA — created on first private distribution.
    #[account(
        init,
        payer = distributor,
        seeds = [b"distribution", capsule.key().as_ref()],
        bump,
        space = 8 + CapsuleDistribution::LEN
    )]
    pub distribution: Account<'info, CapsuleDistribution>,
}

/// Prepare private distribution: transfer remaining vault funds to the distributor's base wallet.
/// This instruction is called by the crank/cron after execute_intent when distributionMode="private".
/// For SPL tokens, transfers from vault ATA to distributor's ATA.
/// For SOL, transfers lamports directly to distributor.
pub fn handler(ctx: Context<PreparePrivateDistribution>) -> Result<()> {
    let capsule = &mut ctx.accounts.capsule;
    require!(!capsule.is_active, ErrorCode::CapsuleActive);
    require!(capsule.executed_at.is_some(), ErrorCode::CapsuleNotExecuted);
    require!(!capsule.private_distributed, ErrorCode::PrivateDistributionAlreadyDone);

    let intent_data_str = String::from_utf8(capsule.intent_data.clone())
        .map_err(|_| ErrorCode::InvalidIntentData)?;
    let intent_json: serde_json::Value = serde_json::from_str(&intent_data_str)
        .map_err(|_| ErrorCode::InvalidIntentData)?;

    // Ensure private distribution was requested
    require!(wants_private_distribution(&intent_json), ErrorCode::PrivateDistributionNotEnabled);

    let vault_bump = capsule.vault_bump;
    let owner_key = capsule.owner;
    let vault_seeds: &[&[u8]] = &[b"capsule_vault", owner_key.as_ref(), &[vault_bump]];
    let signer_seeds = &[vault_seeds];

    let is_spl = capsule.mint != Pubkey::default();

    // Deduct and send platform execution fee first. Fee is driven by the REAL locked balance,
    // not the owner-asserted intent_data.totalAmount (audit H4); the parsed total is only a
    // fallback for legacy capsules that predate locked_amount.
    let total_amount_units = {
        let total_str = intent_json
            .get("totalAmount")
            .and_then(|t| t.as_str())
            .ok_or(ErrorCode::InvalidIntentData)?;
        let asset_decimals =
            infer_asset_decimals(&intent_json, ctx.accounts.mint.as_ref().map(|m| m.decimals));
        parse_amount_to_units(total_str, asset_decimals).map_err(|_| ErrorCode::InvalidIntentData)?
    };
    let pool = if capsule.locked_amount > 0 { capsule.locked_amount } else { total_amount_units };

    let fee_config = &ctx.accounts.fee_config;
    if fee_config.execution_fee_bps > 0 {
        let execution_fee = pool
            .checked_mul(fee_config.execution_fee_bps as u64)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(ErrorCode::InvalidIntentData)?;

        if execution_fee > 0 {
            let platform_recipient = ctx
                .accounts
                .platform_fee_recipient
                .as_mut()
                .ok_or(ErrorCode::InvalidFeeConfig)?;
            if is_spl {
                let mint = ctx.accounts.mint.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
                let expected_fee_recipient_ata =
                    get_associated_token_address(&fee_config.fee_recipient, &mint.key());
                require!(
                    platform_recipient.key() == expected_fee_recipient_ata,
                    ErrorCode::InvalidFeeConfig
                );

                let vault_ata = ctx.accounts.vault_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
                let cpi_accounts = Transfer {
                    from: vault_ata.to_account_info(),
                    to: platform_recipient.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                };
                let cpi_program = ctx.accounts.token_program.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?.to_account_info();
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                token::transfer(cpi_ctx, execution_fee)?;
            } else {
                require!(platform_recipient.key() == fee_config.fee_recipient, ErrorCode::InvalidFeeConfig);
                **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= execution_fee;
                **platform_recipient.to_account_info().try_borrow_mut_lamports()? += execution_fee;
            }
            msg!("Execution fee {} sent to platform", execution_fee);
        }
    }

    // Transfer remainder to distributor
    if is_spl {
        let vault_ata = ctx.accounts.vault_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        let distributor_ata = ctx.accounts.distributor_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        let remaining = vault_ata.amount;
        if remaining > 0 {
            let cpi_accounts = Transfer {
                from: vault_ata.to_account_info(),
                to: distributor_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
            token::transfer(cpi_ctx, remaining)?;
            msg!("Transferred {} SPL tokens from vault to distributor", remaining);
        }
    } else {
        let vault_account = ctx.accounts.vault.to_account_info();
        let distributor_account = ctx.accounts.distributor.to_account_info();
        let vault_balance = **vault_account.try_borrow_lamports()?;
        if vault_balance > 0 {
            **vault_account.try_borrow_mut_lamports()? -= vault_balance;
            **distributor_account.try_borrow_mut_lamports()? += vault_balance;
            msg!("Transferred {} lamports from vault to distributor", vault_balance);
        }
    }

    capsule.private_distributed = true;
    msg!("Capsule {} marked as privately distributed", capsule.key());

    Ok(())
}

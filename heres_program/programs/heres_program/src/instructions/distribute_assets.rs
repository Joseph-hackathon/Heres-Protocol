//! Distribute vault assets to beneficiaries on the base layer (after execute_intent).

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::events::CcipTransferRequested;
use crate::state::{CapsuleVault, FeeConfig, IntentCapsule};
use crate::utils::{infer_asset_decimals, parse_amount_to_units};

#[derive(Accounts)]
pub struct DistributeAssets<'info> {
    #[account(
        mut,
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

    pub system_program: Program<'info, System>,

    pub token_program: Program<'info, Token>,

    #[account(seeds = [b"fee_config"], bump)]
    pub fee_config: Box<Account<'info, FeeConfig>>,

    /// Platform fee recipient
    #[account(mut)]
    pub platform_fee_recipient: Option<AccountInfo<'info>>,

    pub mint: Option<Box<Account<'info, Mint>>>,

    #[account(mut)]
    pub vault_token_account: Option<Box<Account<'info, TokenAccount>>>,
}

/// Distribute assets from the vault to beneficiaries. Call on base layer after execute_intent.
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, DistributeAssets<'info>>,
) -> Result<()> {
    let capsule = &ctx.accounts.capsule;
    require!(!capsule.is_active, ErrorCode::CapsuleActive);
    require!(capsule.executed_at.is_some(), ErrorCode::CapsuleNotExecuted);
    // Idempotency: distribute_assets is permissionless (it is a crank). Without this guard a
    // second call re-pays the Solana heirs out of the funds reserved for EVM/CCIP heirs in
    // mixed intents, starving the EVM heir (audit H1).
    require!(!capsule.distributed, ErrorCode::AlreadyDistributed);

    // Parse intent data
    let intent_data_str = String::from_utf8(capsule.intent_data.clone())
        .map_err(|_| ErrorCode::InvalidIntentData)?;
    let intent_json: serde_json::Value = serde_json::from_str(&intent_data_str)
        .map_err(|_| ErrorCode::InvalidIntentData)?;

    let beneficiaries = intent_json
        .get("beneficiaries")
        .and_then(|b| b.as_array())
        .ok_or(ErrorCode::InvalidIntentData)?;

    let total_amount_str = intent_json
        .get("totalAmount")
        .and_then(|t| t.as_str())
        .ok_or(ErrorCode::InvalidIntentData)?;

    let asset_decimals = infer_asset_decimals(&intent_json, None);
    let total_amount_units = parse_amount_to_units(total_amount_str, asset_decimals)
        .map_err(|_| ErrorCode::InvalidIntentData)?;

    let vault_bump = capsule.vault_bump;
    let owner_key = capsule.owner;
    let is_spl = capsule.mint != Pubkey::default();
    // Drive fee + distributable pool from the REAL locked balance, not the owner-asserted
    // intent_data.totalAmount (which update_intent can desync). The asserted total stays only as
    // the proportion denominator for beneficiary weights (audit H4). Falls back to the asserted
    // total if locked_amount was never recorded (legacy capsules), preserving prior behavior.
    let pool = if capsule.locked_amount > 0 { capsule.locked_amount } else { total_amount_units };
    let vault_seeds: &[&[u8]] = &[b"capsule_vault", owner_key.as_ref(), &[vault_bump]];
    let signer_seeds = &[vault_seeds];

    // Platform execution fee
    let fee_config = &ctx.accounts.fee_config;
    let mut remaining_for_beneficiaries = pool;

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
                let cpi_program = ctx.accounts.token_program.to_account_info();
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                token::transfer(cpi_ctx, execution_fee)?;
            } else {
                require!(platform_recipient.key() == fee_config.fee_recipient, ErrorCode::InvalidFeeConfig);
                **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= execution_fee;
                **platform_recipient.to_account_info().try_borrow_mut_lamports()? += execution_fee;
            }
            remaining_for_beneficiaries = pool.saturating_sub(execution_fee);
            msg!("Execution fee {} sent to platform", execution_fee);
        }
    }

    // Distribute to beneficiaries
    let total_for_ratio = total_amount_units;
    let mut distributed: u64 = 0;
    let beneficiary_count = beneficiaries.len();

    for (idx, beneficiary) in beneficiaries.iter().enumerate() {
        let beneficiary_chain = beneficiary
            .get("chain")
            .and_then(|c| c.as_str())
            .unwrap_or("solana");

        let address_str = beneficiary
            .get("address")
            .and_then(|a| a.as_str())
            .ok_or(ErrorCode::InvalidIntentData)?;

        let amount_str = beneficiary
            .get("amount")
            .and_then(|a| a.as_str())
            .ok_or(ErrorCode::InvalidIntentData)?;

        let amount_type = beneficiary
            .get("amountType")
            .and_then(|t| t.as_str())
            .unwrap_or("fixed");

        let amount_units = if amount_type == "percentage" {
            let percentage = amount_str.parse::<f64>().map_err(|_| ErrorCode::InvalidIntentData)?;
            (total_amount_units as f64 * percentage / 100.0) as u64
        } else {
            parse_amount_to_units(amount_str, asset_decimals).map_err(|_| ErrorCode::InvalidIntentData)?
        };

        let to_send = if total_for_ratio == 0 {
            0u64
        } else if idx == beneficiary_count.saturating_sub(1) {
            remaining_for_beneficiaries.saturating_sub(distributed)
        } else {
            amount_units
                .checked_mul(remaining_for_beneficiaries)
                .and_then(|v| v.checked_div(total_for_ratio))
                .unwrap_or(0)
        };
        distributed = distributed.saturating_add(to_send);

        if beneficiary_chain == "evm" {
            if to_send > 0 {
                let destination_chain_selector = beneficiary
                    .get("destinationChainSelector")
                    .and_then(|s| s.as_str())
                    .unwrap_or_default()
                    .to_string();

                emit!(CcipTransferRequested {
                    capsule: ctx.accounts.capsule.key(),
                    beneficiary_index: idx as u16,
                    evm_address: address_str.to_string(),
                    destination_chain_selector,
                    amount_lamports: to_send,
                });
                msg!("Queued CCIP transfer for EVM beneficiary {}: {} lamports", address_str, to_send);
            }
            continue;
        }

        if beneficiary_chain != "solana" {
            return err!(ErrorCode::UnsupportedBeneficiaryChain);
        }

        if to_send > 0 {
            let beneficiary_pubkey = address_str.parse::<Pubkey>()
                .map_err(|_| ErrorCode::InvalidBeneficiaryAddress)?;

            if is_spl {
                let mint = ctx.accounts.mint.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
                let expected_beneficiary_ata =
                    get_associated_token_address(&beneficiary_pubkey, &mint.key());
                let beneficiary_account = ctx
                    .remaining_accounts
                    .iter()
                    .find(|acc| acc.key() == expected_beneficiary_ata)
                    .ok_or(ErrorCode::InvalidBeneficiaryAddress)?;
                let vault_ata = ctx.accounts.vault_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
                let cpi_accounts = Transfer {
                    from: vault_ata.to_account_info(),
                    to: beneficiary_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                };
                let cpi_program = ctx.accounts.token_program.to_account_info();
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
                token::transfer(cpi_ctx, to_send)?;
            } else {
                let beneficiary_account = ctx
                    .remaining_accounts
                    .iter()
                    .find(|acc| acc.key() == beneficiary_pubkey)
                    .ok_or(ErrorCode::InvalidBeneficiaryAddress)?;
                **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= to_send;
                **beneficiary_account.to_account_info().try_borrow_mut_lamports()? += to_send;
            }
            msg!("Transferred {} to beneficiary: {}", to_send, beneficiary_pubkey);
        }
    }

    // Mark distributed so this permissionless crank cannot be replayed (audit H1).
    ctx.accounts.capsule.distributed = true;

    Ok(())
}

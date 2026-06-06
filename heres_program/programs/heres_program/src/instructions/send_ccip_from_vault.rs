//! Send a queued EVM beneficiary transfer through the CCIP Router from vault PDA custody.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use crate::constants::{CCIP_ROUTER_ID, LINK_TOKEN_MINT};
use crate::error::ErrorCode;
use crate::events::CcipTransferSent;
use crate::state::{CapsuleVault, FeeConfig, IntentCapsule};
use crate::utils::{infer_asset_decimals, parse_amount_to_units};

/// Discriminator for the CCIP Router `ccip_send` instruction.
const CCIP_SEND_DISCRIMINATOR: [u8; 8] = [108, 216, 134, 191, 249, 234, 33, 84];

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SvmTokenAmount {
    pub token: Pubkey,
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Svm2AnyMessage {
    pub receiver: Vec<u8>,
    pub data: Vec<u8>,
    pub token_amounts: Vec<SvmTokenAmount>,
    pub fee_token: Pubkey,
    pub extra_args: Vec<u8>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CcipSendRouterArgs {
    pub dest_chain_selector: u64,
    pub message: Svm2AnyMessage,
    pub token_indexes: Vec<u8>,
}

#[derive(Accounts)]
pub struct SendCcipFromVault<'info> {
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

    #[account(seeds = [b"fee_config"], bump)]
    pub fee_config: Box<Account<'info, FeeConfig>>,

    /// Chainlink CCIP Router. Pinned by address: the vault PDA is signed into this program,
    /// so an unconstrained router would let an attacker substitute a malicious program and
    /// drain the SPL vault (audit C2).
    /// CHECK: validated by address against CCIP_ROUTER_ID.
    #[account(address = CCIP_ROUTER_ID @ ErrorCode::InvalidCcipAccounts)]
    pub ccip_router: AccountInfo<'info>,
}

/// Send a queued EVM beneficiary transfer through CCIP Router from vault PDA custody.
/// The message fields (receiver/amount/selector) are derived from intent_data on-chain.
/// Caller only provides the router account list in remaining_accounts.
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, SendCcipFromVault<'info>>,
    beneficiary_index: u16,
) -> Result<()> {
    let capsule = &ctx.accounts.capsule;
    require!(!capsule.is_active, ErrorCode::CapsuleActive);
    require!(capsule.executed_at.is_some(), ErrorCode::CapsuleNotExecuted);
    require!(capsule.mint != Pubkey::default(), ErrorCode::InvalidTokenAccount);
    require!(ctx.remaining_accounts.len() >= 18, ErrorCode::InvalidCcipAccounts);

    // Double-send prevention: check bitmap
    let bit = 1u16 << beneficiary_index;
    require!(capsule.ccip_sent_bitmap & bit == 0, ErrorCode::CcipAlreadySent);

    // Parse intent data and target beneficiary
    let intent_data_str = String::from_utf8(capsule.intent_data.clone())
        .map_err(|_| ErrorCode::InvalidIntentData)?;
    let intent_json: serde_json::Value = serde_json::from_str(&intent_data_str)
        .map_err(|_| ErrorCode::InvalidIntentData)?;
    let beneficiaries = intent_json
        .get("beneficiaries")
        .and_then(|b| b.as_array())
        .ok_or(ErrorCode::InvalidIntentData)?;

    let target = beneficiaries
        .get(beneficiary_index as usize)
        .ok_or(ErrorCode::InvalidIntentData)?;
    let target_chain = target.get("chain").and_then(|c| c.as_str()).unwrap_or("solana");
    require!(target_chain == "evm", ErrorCode::UnsupportedBeneficiaryChain);

    let evm_address = target
        .get("address")
        .and_then(|a| a.as_str())
        .ok_or(ErrorCode::InvalidIntentData)?;
    let destination_chain_selector_str = target
        .get("destinationChainSelector")
        .and_then(|s| s.as_str())
        .ok_or(ErrorCode::InvalidIntentData)?;
    let destination_chain_selector = destination_chain_selector_str
        .parse::<u64>()
        .map_err(|_| ErrorCode::InvalidIntentData)?;

    // Recompute amount for target beneficiary using same ratio logic as distribute_assets.
    // The asserted total is the proportion denominator only; the actual pool is the real
    // locked balance so this stays consistent with distribute_assets (audit H4).
    let total_amount_str = intent_json
        .get("totalAmount")
        .and_then(|t| t.as_str())
        .ok_or(ErrorCode::InvalidIntentData)?;
    let asset_decimals = infer_asset_decimals(&intent_json, None);
    let total_amount_units = parse_amount_to_units(total_amount_str, asset_decimals)
        .map_err(|_| ErrorCode::InvalidIntentData)?;

    let pool = capsule.locked_amount;
    let mut remaining_for_beneficiaries = pool;
    if ctx.accounts.fee_config.execution_fee_bps > 0 {
        let execution_fee = pool
            .checked_mul(ctx.accounts.fee_config.execution_fee_bps as u64)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(ErrorCode::InvalidIntentData)?;
        remaining_for_beneficiaries = pool.saturating_sub(execution_fee);
    }

    let total_for_ratio = total_amount_units;
    let mut distributed: u64 = 0;
    let beneficiary_count = beneficiaries.len();
    let mut amount_for_target: u64 = 0;

    for (idx, beneficiary) in beneficiaries.iter().enumerate() {
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
        if idx == beneficiary_index as usize {
            amount_for_target = to_send;
            break;
        }
    }
    require!(amount_for_target > 0, ErrorCode::InvalidIntentData);

    let receiver_bytes = evm_address_to_bytes32(evm_address)?;
    let extra_args = default_ccip_extra_args();

    // Build ccip_send args payload with Anchor/Borsh encoding
    let send_args = CcipSendRouterArgs {
        dest_chain_selector: destination_chain_selector,
        message: Svm2AnyMessage {
            receiver: receiver_bytes.to_vec(),
            data: vec![],
            token_amounts: vec![SvmTokenAmount {
                token: capsule.mint,
                amount: amount_for_target,
            }],
            fee_token: LINK_TOKEN_MINT, // LINK token fee (vault PDA is program-owned, can't use native SOL)
            extra_args,
        },
        token_indexes: vec![0u8],
    };
    let mut ccip_data = CCIP_SEND_DISCRIMINATOR.to_vec();
    ccip_data.extend_from_slice(&send_args.try_to_vec()?);

    // remaining_accounts must follow router ccip_send fixed account order.
    // Index 3 is authority and must be vault PDA key.
    require!(
        ctx.remaining_accounts[3].key() == ctx.accounts.vault.key(),
        ErrorCode::InvalidCcipAccounts
    );

    let mut metas: Vec<AccountMeta> = Vec::with_capacity(ctx.remaining_accounts.len());
    for account in ctx.remaining_accounts.iter() {
        let is_signer = if account.key() == ctx.accounts.vault.key() {
            true
        } else {
            account.is_signer
        };
        metas.push(AccountMeta {
            pubkey: account.key(),
            is_signer,
            is_writable: account.is_writable,
        });
    }

    let ccip_ix = Instruction {
        program_id: ctx.accounts.ccip_router.key(),
        accounts: metas,
        data: ccip_data,
    };

    let owner_key = capsule.owner;
    let vault_bump = capsule.vault_bump;
    let vault_seeds: &[&[u8]] = &[b"capsule_vault", owner_key.as_ref(), &[vault_bump]];
    let signer_seeds = &[vault_seeds];

    let mut infos: Vec<AccountInfo<'info>> = ctx.remaining_accounts.to_vec();
    infos.push(ctx.accounts.ccip_router.to_account_info());

    invoke_signed(&ccip_ix, &infos, signer_seeds)?;

    // Mark beneficiary as sent in bitmap
    ctx.accounts.capsule.ccip_sent_bitmap |= 1u16 << beneficiary_index;

    emit!(CcipTransferSent {
        capsule: ctx.accounts.capsule.key(),
        beneficiary_index,
        evm_address: evm_address.to_string(),
        destination_chain_selector: destination_chain_selector_str.to_string(),
        amount_lamports: amount_for_target,
    });
    msg!(
        "CCIP transfer sent from vault. beneficiary_index={}, evm_address={}, amount={}",
        beneficiary_index,
        evm_address,
        amount_for_target
    );
    Ok(())
}

fn default_ccip_extra_args() -> Vec<u8> {
    // EVMExtraArgsV2 tag (0x181dcf10) + gas_limit u128 LE + allow_out_of_order_execution bool
    let mut buf = vec![0x18, 0x1d, 0xcf, 0x10];
    buf.extend_from_slice(&[0u8; 16]); // gas_limit=0
    buf.push(1u8); // allow_out_of_order_execution=true
    buf
}

fn evm_address_to_bytes32(addr: &str) -> Result<[u8; 32]> {
    let hex = addr.strip_prefix("0x").ok_or(ErrorCode::InvalidIntentData)?;
    require!(hex.len() == 40, ErrorCode::InvalidIntentData);
    let mut out = [0u8; 32];
    for i in 0..20 {
        let from = i * 2;
        let byte = u8::from_str_radix(&hex[from..from + 2], 16)
            .map_err(|_| ErrorCode::InvalidIntentData)?;
        out[12 + i] = byte;
    }
    Ok(out)
}

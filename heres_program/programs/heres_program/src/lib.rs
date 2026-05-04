use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    pubkey::pubkey,
};
use ephemeral_rollups_sdk::anchor::{delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;
use magicblock_magic_program_api::{args::ScheduleTaskArgs, instruction::MagicBlockInstruction};
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use anchor_spl::associated_token::{get_associated_token_address, AssociatedToken};
#[cfg(feature = "oracle")]
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

declare_id!("AmiL7vEZ2SpAuDXzdxC3sJMyjZqgacvwvvQdT3qosmsW");

/// TEE validator for Private Ephemeral Rollup (PER). Used as default when no validator account is passed.
pub const TEE_VALIDATOR: Pubkey = pubkey!("FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA");

/// MagicBlock Permission Program ID for Access Control
pub const PERMISSION_PROGRAM_ID: Pubkey = pubkey!("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");

/// Discriminator for execute_intent (no args) ??from IDL
const EXECUTE_INTENT_DISCRIMINATOR: [u8; 8] = [53, 130, 47, 154, 227, 220, 122, 212];
/// Discriminator for CCIP Router ccip_send
const CCIP_SEND_DISCRIMINATOR: [u8; 8] = [108, 216, 134, 191, 249, 234, 33, 84];
/// LINK token mint on devnet (used as CCIP fee token — vault PDA is program-owned, not system-owned)
pub const LINK_TOKEN_MINT: Pubkey = pubkey!("LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L");

#[ephemeral]
#[program]
pub mod heres_program {
    use super::*;

    /// Initialize platform fee config (call once after deploy; only authority can update later)
    pub fn init_fee_config(
        ctx: Context<InitFeeConfig>,
        fee_recipient: Pubkey,
        creation_fee_lamports: u64,
        execution_fee_bps: u16,
    ) -> Result<()> {
        require!(execution_fee_bps <= 10000, ErrorCode::InvalidFeeConfig);
        let config = &mut ctx.accounts.fee_config;
        config.authority = ctx.accounts.authority.key();
        config.fee_recipient = fee_recipient;
        config.creation_fee_lamports = creation_fee_lamports;
        config.execution_fee_bps = execution_fee_bps;
        msg!("Fee config initialized: recipient={:?}, creation_fee={}, execution_bps={}", fee_recipient, creation_fee_lamports, execution_fee_bps);
        Ok(())
    }

    /// Update platform fee config (authority only)
    pub fn update_fee_config(
        ctx: Context<UpdateFeeConfig>,
        creation_fee_lamports: u64,
        execution_fee_bps: u16,
    ) -> Result<()> {
        require!(execution_fee_bps <= 10000, ErrorCode::InvalidFeeConfig);
        let config = &mut ctx.accounts.fee_config;
        require!(config.authority == ctx.accounts.authority.key(), ErrorCode::Unauthorized);
        config.creation_fee_lamports = creation_fee_lamports;
        config.execution_fee_bps = execution_fee_bps;
        msg!("Fee config updated: creation_fee={}, execution_bps={}", creation_fee_lamports, execution_fee_bps);
        Ok(())
    }

    /// Initialize a new Intent Capsule (SOL locked in vault; anyone can execute when conditions are met).
    /// PER: Uses Magicblock Permission Program to restrict intent_data access to TEE validator and Owner only.
    pub fn create_capsule(
        ctx: Context<CreateCapsule>,
        inactivity_period: i64,
        intent_data: Vec<u8>,
    ) -> Result<()> {
        // Parse totalAmount from intent_data
        let total_amount_units = {
            let intent_data_str = String::from_utf8(intent_data.clone())
                .map_err(|_| ErrorCode::InvalidIntentData)?;
            let intent_json: serde_json::Value = serde_json::from_str(&intent_data_str)
                .map_err(|_| ErrorCode::InvalidIntentData)?;
            let total_str = intent_json.get("totalAmount")
                .and_then(|t| t.as_str())
                .ok_or(ErrorCode::InvalidIntentData)?;
            let asset_decimals = infer_asset_decimals(&intent_json, ctx.accounts.mint.as_ref().map(|mint| mint.decimals));
            parse_amount_to_units(total_str, asset_decimals).map_err(|_| ErrorCode::InvalidIntentData)?
        };

        let fee_config = &ctx.accounts.fee_config;
        if fee_config.creation_fee_lamports > 0 {
            let platform_recipient = ctx.accounts.platform_fee_recipient.as_mut().ok_or(ErrorCode::InvalidFeeConfig)?;
            // Ensure the recipient matches the one provided in the config
            require!(platform_recipient.key() == fee_config.fee_recipient, ErrorCode::InvalidFeeConfig);
            
            let cpi_accounts = system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: platform_recipient.clone(),
            };
            let cpi_program = ctx.accounts.system_program.to_account_info();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
            system_program::transfer(cpi_ctx, fee_config.creation_fee_lamports)?;
            msg!("Creation fee {} lamports sent to platform recipient: {:?}", fee_config.creation_fee_lamports, platform_recipient.key());
        }

        let capsule = &mut ctx.accounts.capsule;
        capsule.owner = ctx.accounts.owner.key();
        capsule.inactivity_period = inactivity_period;
        capsule.last_activity = Clock::get()?.unix_timestamp;
        capsule.intent_data = intent_data;
        capsule.is_active = true;
        capsule.bump = ctx.bumps.capsule;
        capsule.vault_bump = ctx.bumps.vault;

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

    /// Update the intent data of an existing capsule
    pub fn update_intent(
        ctx: Context<UpdateIntent>,
        new_intent_data: Vec<u8>,
    ) -> Result<()> {
        let capsule = &mut ctx.accounts.capsule;
        require!(capsule.owner == ctx.accounts.owner.key(), ErrorCode::Unauthorized);
        require!(capsule.is_active, ErrorCode::CapsuleInactive);
        
        capsule.intent_data = new_intent_data;
        capsule.last_activity = Clock::get()?.unix_timestamp;
        
        msg!("Intent updated for capsule: {:?}", capsule.key());
        Ok(())
    }

    /// Execute the intent when inactivity period is met. Anyone can call (no owner signature required).
    /// This instruction is optimized for ER/TEE: it only updates the capsule state.
    /// Actual distribution happens on the base layer via distribute_assets.
    pub fn execute_intent(
        ctx: Context<ExecuteIntent>,
    ) -> Result<()> {
        let capsule = &mut ctx.accounts.capsule;
        require!(capsule.is_active, ErrorCode::CapsuleInactive);
        
        let current_time = Clock::get()?.unix_timestamp;
        let time_since_activity = current_time - capsule.last_activity;
        
        require!(
            time_since_activity >= capsule.inactivity_period,
            ErrorCode::InactivityPeriodNotMet
        );
        
        // FAIL-SAFE / AUTO-RESTART: 
        // If the execution is triggered but we want to "delay" it or if it's a re-occurring check,
        // we could reset the timer instead. 
        // For now, we follow the standard execute -> deactivate flow.
        
        capsule.is_active = false;
        capsule.executed_at = Some(current_time);

        msg!("Intent executed (state updated) for capsule: {:?}", capsule.key());
        emit!(IntentExecuted {
            capsule: capsule.key(),
            owner: capsule.owner,
            executed_at: current_time,
        });

        // NOTE: commit_and_undelegate cannot be in the same instruction as state changes
        // because Solana runtime detects ExternalAccountDataModified when Magic program
        // changes ownership metadata on accounts we already modified.
        // Undelegation must be handled in a separate transaction after execution.

        Ok(())
    }

    /// Reset the inactivity timer (Fail-safe / Auto-restart).
    /// Allows the owner or the system (via TEE) to restart the 1-year (or set period) countdown.
    /// This is used if the Crank needs to be rebooted or if the owner proves they are still active.
    pub fn restart_timer(ctx: Context<RestartTimer>) -> Result<()> {
        let capsule = &mut ctx.accounts.capsule;
        require!(capsule.is_active, ErrorCode::CapsuleInactive);
        
        // In a real TEE fail-safe, this could be triggered by an external "I'm alive" signal
        // or by the TEE itself if a previous execution cycle failed to reach L1.
        capsule.last_activity = Clock::get()?.unix_timestamp;
        capsule.retry_count += 1;
        
        msg!("Timer restarted for capsule: {:?}. New last_activity: {}", capsule.key(), capsule.last_activity);
        Ok(())
    }

    /// Distribute assets from the vault to beneficiaries. Call on base layer after execute_intent.
    pub fn distribute_assets<'info>(
        ctx: Context<'_, '_, '_, 'info, DistributeAssets<'info>>,
    ) -> Result<()> {
        let capsule = &ctx.accounts.capsule;
        require!(!capsule.is_active, ErrorCode::CapsuleActive);
        require!(capsule.executed_at.is_some(), ErrorCode::CapsuleNotExecuted);
        
        // Parse intent data
        let intent_data_str = String::from_utf8(capsule.intent_data.clone())
            .map_err(|_| ErrorCode::InvalidIntentData)?;
        let intent_json: serde_json::Value = serde_json::from_str(&intent_data_str)
            .map_err(|_| ErrorCode::InvalidIntentData)?;
        
        let beneficiaries = intent_json.get("beneficiaries")
            .and_then(|b| b.as_array())
            .ok_or(ErrorCode::InvalidIntentData)?;
        
        let total_amount_str = intent_json.get("totalAmount")
            .and_then(|t| t.as_str())
            .ok_or(ErrorCode::InvalidIntentData)?;
        
        let asset_decimals = infer_asset_decimals(&intent_json, None);
        let total_amount_units = parse_amount_to_units(total_amount_str, asset_decimals)
            .map_err(|_| ErrorCode::InvalidIntentData)?;
        
        let vault_bump = capsule.vault_bump;
        let owner_key = capsule.owner;
        let vault_seeds: &[&[u8]] = &[
            b"capsule_vault",
            owner_key.as_ref(),
            &[vault_bump],
        ];
        let signer_seeds = &[vault_seeds];
        
        // Platform execution fee
        let fee_config = &ctx.accounts.fee_config;
        let mut remaining_for_beneficiaries = total_amount_units;
        let is_spl = capsule.mint != Pubkey::default();

        if fee_config.execution_fee_bps > 0 {
            let execution_fee = total_amount_units
                .checked_mul(fee_config.execution_fee_bps as u64)
                .and_then(|v| v.checked_div(10_000))
                .ok_or(ErrorCode::InvalidIntentData)?;
            
            if execution_fee > 0 {
                let platform_recipient = ctx.accounts.platform_fee_recipient.as_mut().ok_or(ErrorCode::InvalidFeeConfig)?;
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
                remaining_for_beneficiaries = total_amount_units.saturating_sub(execution_fee);
                msg!("Execution fee {} sent to platform", execution_fee);
            }
        }
        
        // Distribute to beneficiaries
        let total_for_ratio = total_amount_units;
        let mut distributed: u64 = 0;
        let beneficiary_count = beneficiaries.len();
        
        for (idx, beneficiary) in beneficiaries.iter().enumerate() {
            let beneficiary_chain = beneficiary.get("chain")
                .and_then(|c| c.as_str())
                .unwrap_or("solana");

            let address_str = beneficiary.get("address")
                .and_then(|a| a.as_str())
                .ok_or(ErrorCode::InvalidIntentData)?;

            let amount_str = beneficiary.get("amount")
                .and_then(|a| a.as_str())
                .ok_or(ErrorCode::InvalidIntentData)?;
            
            let amount_type = beneficiary.get("amountType")
                .and_then(|t| t.as_str())
                .unwrap_or("fixed");
            
            let amount_units = if amount_type == "percentage" {
                let percentage = amount_str.parse::<f64>()
                    .map_err(|_| ErrorCode::InvalidIntentData)?;
                (total_amount_units as f64 * percentage / 100.0) as u64
            } else {
                parse_amount_to_units(amount_str, asset_decimals)
                    .map_err(|_| ErrorCode::InvalidIntentData)?
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
                    let beneficiary_account = ctx.remaining_accounts
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
                    let beneficiary_account = ctx.remaining_accounts
                        .iter()
                        .find(|acc| acc.key() == beneficiary_pubkey)
                        .ok_or(ErrorCode::InvalidBeneficiaryAddress)?;
                    **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= to_send;
                    **beneficiary_account.to_account_info().try_borrow_mut_lamports()? += to_send;
                }
                msg!("Transferred {} to beneficiary: {}", to_send, beneficiary_pubkey);
            }
        }
        
        Ok(())
    }

    /// Send a queued EVM beneficiary transfer through CCIP Router from vault PDA custody.
    /// The message fields (receiver/amount/selector) are derived from intent_data on-chain.
    /// Caller only provides the router account list in remaining_accounts.
    pub fn send_ccip_from_vault<'info>(
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
        let beneficiaries = intent_json.get("beneficiaries")
            .and_then(|b| b.as_array())
            .ok_or(ErrorCode::InvalidIntentData)?;

        let target = beneficiaries
            .get(beneficiary_index as usize)
            .ok_or(ErrorCode::InvalidIntentData)?;
        let target_chain = target.get("chain").and_then(|c| c.as_str()).unwrap_or("solana");
        require!(target_chain == "evm", ErrorCode::UnsupportedBeneficiaryChain);

        let evm_address = target.get("address")
            .and_then(|a| a.as_str())
            .ok_or(ErrorCode::InvalidIntentData)?;
        let destination_chain_selector_str = target
            .get("destinationChainSelector")
            .and_then(|s| s.as_str())
            .ok_or(ErrorCode::InvalidIntentData)?;
        let destination_chain_selector = destination_chain_selector_str
            .parse::<u64>()
            .map_err(|_| ErrorCode::InvalidIntentData)?;

        // Recompute amount for target beneficiary using same ratio logic as distribute_assets
        let total_amount_str = intent_json.get("totalAmount")
            .and_then(|t| t.as_str())
            .ok_or(ErrorCode::InvalidIntentData)?;
        let asset_decimals = infer_asset_decimals(&intent_json, None);
        let total_amount_units = parse_amount_to_units(total_amount_str, asset_decimals)
            .map_err(|_| ErrorCode::InvalidIntentData)?;

        let mut remaining_for_beneficiaries = total_amount_units;
        if ctx.accounts.fee_config.execution_fee_bps > 0 {
            let execution_fee = total_amount_units
                .checked_mul(ctx.accounts.fee_config.execution_fee_bps as u64)
                .and_then(|v| v.checked_div(10_000))
                .ok_or(ErrorCode::InvalidIntentData)?;
            remaining_for_beneficiaries = total_amount_units.saturating_sub(execution_fee);
        }

        let total_for_ratio = total_amount_units;
        let mut distributed: u64 = 0;
        let beneficiary_count = beneficiaries.len();
        let mut amount_for_target: u64 = 0;

        for (idx, beneficiary) in beneficiaries.iter().enumerate() {
            let amount_str = beneficiary.get("amount")
                .and_then(|a| a.as_str())
                .ok_or(ErrorCode::InvalidIntentData)?;
            let amount_type = beneficiary.get("amountType")
                .and_then(|t| t.as_str())
                .unwrap_or("fixed");
            let amount_units = if amount_type == "percentage" {
                let percentage = amount_str.parse::<f64>()
                    .map_err(|_| ErrorCode::InvalidIntentData)?;
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
        let vault_seeds: &[&[u8]] = &[
            b"capsule_vault",
            owner_key.as_ref(),
            &[vault_bump],
        ];
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

    /// Update last activity timestamp (called by Helius webhook or user)
    pub fn update_activity(ctx: Context<UpdateActivity>) -> Result<()> {
        let capsule = &mut ctx.accounts.capsule;
        require!(capsule.owner == ctx.accounts.owner.key(), ErrorCode::Unauthorized);
        
        capsule.last_activity = Clock::get()?.unix_timestamp;
        
        msg!("Activity updated for capsule: {:?}", capsule.key());
        Ok(())
    }


    /// Delegate capsule and vault PDAs to Magicblock ER/PER. When no validator is passed, defaults to TEE validator (PER).
    /// The #[delegate] macro handles this automatically for all fields marked with 'del'.
    pub fn delegate_capsule(ctx: Context<DelegateCapsuleInput>) -> Result<()> {
        let validator_key = ctx.accounts.validator
            .as_ref()
            .map(|v| v.key())
            .unwrap_or(crate::TEE_VALIDATOR);

        msg!("Delegating capsule and vault to Ephemeral Rollup");
        let owner_key = ctx.accounts.owner.key();

        // Delegate Capsule PDA
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer, 
            &[b"intent_capsule", owner_key.as_ref()], 
            DelegateConfig {
                commit_frequency_ms: 0,
                validator: Some(validator_key),
            }
        )?;

        // Delegate Vault PDA
        ctx.accounts.delegate_vault(
            &ctx.accounts.payer, 
            &[b"capsule_vault", owner_key.as_ref()], 
            DelegateConfig {
                commit_frequency_ms: 0,
                validator: Some(validator_key),
            }
        )?;

        msg!("Capsule and Vault delegated to Ephemeral Rollup");
        Ok(())
    }

    /// Commit state from ER and undelegate capsule + vault back to base layer.
    /// This is a separate instruction from execute_intent to avoid ExternalAccountDataModified.
    /// Anyone (crank) can call this — no owner signature required.
    pub fn crank_undelegate(ctx: Context<CrankUndelegateInput>) -> Result<()> {
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
        )?;

        msg!("Capsule and Vault commit+undelegate scheduled");
        Ok(())
    }

    /// Schedule crank to run execute_intent at intervals (Magicblock ScheduleTask).
    /// Anyone can execute when conditions are met; this registers the task for the crank.
    pub fn schedule_execute_intent(
        ctx: Context<ScheduleExecuteIntent>,
        args: ScheduleExecuteIntentArgs,
    ) -> Result<()> {
        msg!("Scheduling execute_intent on TEE for capsule: {:?}", ctx.accounts.capsule.key());


        // Accounts for the inner execute_intent instruction called by the ER crank.
        // Only 4 required accounts — undelegation handled separately after execution.
        let accounts = vec![
            AccountMeta::new(ctx.accounts.capsule.key(), false),
            AccountMeta::new(ctx.accounts.vault.key(), false),
            AccountMeta::new_readonly(ctx.accounts.permission_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.permission.key(), false),
        ];

        let execute_ix = Instruction {
            program_id: crate::ID,
            accounts,
            data: EXECUTE_INTENT_DISCRIMINATOR.to_vec(),
        };

        let ix_data = bincode::serialize(&MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
            task_id: args.task_id,
            execution_interval_millis: args.execution_interval_millis,
            iterations: args.iterations,
            instructions: vec![execute_ix],
        }))
        .map_err(|e| {
            msg!("ERROR: failed to serialize ScheduleTask args: {:?}", e);
            ErrorCode::InvalidInstructionData
        })?;

        // Magic Program's ScheduleTask CPI must include ALL accounts referenced
        // by the inner execute_intent instruction, otherwise ER returns MissingAccount.
        let schedule_ix = Instruction::new_with_bytes(
            MAGIC_PROGRAM_ID,
            &ix_data,
            vec![
                AccountMeta::new(ctx.accounts.payer.key(), true),
                AccountMeta::new(ctx.accounts.capsule.key(), false),
                AccountMeta::new(ctx.accounts.vault.key(), false),
                AccountMeta::new_readonly(ctx.accounts.permission_program.key(), false),
                AccountMeta::new_readonly(ctx.accounts.permission.key(), false),
            ],
        );

        invoke_signed(
            &schedule_ix,
            &[
                ctx.accounts.magic_program.to_account_info(),
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.capsule.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.permission_program.to_account_info(),
                ctx.accounts.permission.to_account_info(),
            ],
            &[],
        )?;

        msg!("Scheduled execute_intent crank: task_id={}", args.task_id);
        Ok(())
    }

    /// Read and log SOL/USD (or other) price from Pyth Lazer / ephemeral oracle price feed (for gating or monitoring).
    /// Enable feature "oracle" and pass a Pyth Lazer price feed account (e.g. SOL/USD on Magicblock devnet).
    pub fn sample_price(ctx: Context<SamplePrice>) -> Result<()> {
        #[cfg(feature = "oracle")]
        {
            let data_ref = ctx.accounts.price_update.data.borrow();
            let price_update = PriceUpdateV2::try_deserialize_unchecked(&mut data_ref.as_ref())
                .map_err(|_| ErrorCode::InvalidPriceFeed)?;

            let maximum_age_secs: u64 = 60;
            let feed_id: [u8; 32] = ctx.accounts.price_update.key().to_bytes();
            let price = price_update
                .get_price_no_older_than(&Clock::get()?, maximum_age_secs, &feed_id)
                .map_err(|_| ErrorCode::InvalidPriceFeed)?;

            msg!(
                "Price ({} 짹 {}) * 10^-{}",
                price.price,
                price.conf,
                price.exponent
            );
            msg!(
                "Price value: {}",
                price.price as f64 * 10_f64.powi(-price.exponent)
            );
        }
        #[cfg(not(feature = "oracle"))]
        {
            let _ = ctx;
            msg!("Oracle feature disabled; enable with --features oracle and pass Pyth Lazer price feed account.");
        }
        Ok(())
    }

    /// Recreate a capsule from executed state (owner locks new SOL in vault)
    pub fn recreate_capsule(
        ctx: Context<RecreateCapsule>,
        inactivity_period: i64,
        intent_data: Vec<u8>,
    ) -> Result<()> {
        let capsule = &mut ctx.accounts.capsule;
        require!(capsule.owner == ctx.accounts.owner.key(), ErrorCode::Unauthorized);
        require!(!capsule.is_active, ErrorCode::CapsuleActive);
        require!(capsule.executed_at.is_some(), ErrorCode::CapsuleNotExecuted);
        
        let total_amount_units = {
            let intent_data_str = String::from_utf8(intent_data.clone())
                .map_err(|_| ErrorCode::InvalidIntentData)?;
            let intent_json: serde_json::Value = serde_json::from_str(&intent_data_str)
                .map_err(|_| ErrorCode::InvalidIntentData)?;
            let total_str = intent_json.get("totalAmount")
                .and_then(|t| t.as_str())
                .ok_or(ErrorCode::InvalidIntentData)?;
            let asset_decimals = infer_asset_decimals(&intent_json, None);
            parse_amount_to_units(total_str, asset_decimals).map_err(|_| ErrorCode::InvalidIntentData)?
        };
        
        capsule.inactivity_period = inactivity_period;
        capsule.last_activity = Clock::get()?.unix_timestamp;
        capsule.intent_data = intent_data;
        capsule.is_active = true;
        capsule.executed_at = None;
        
        // Lock new SOL in vault (owner signs)
        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.system_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        system_program::transfer(cpi_ctx, total_amount_units)?;
        msg!("Locked {} lamports in vault for recreated capsule {:?}", total_amount_units, capsule.key());
        
        Ok(())
    }

}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ScheduleExecuteIntentArgs {
    pub task_id: u64,
    pub execution_interval_millis: u64,
    pub iterations: u64,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateCapsuleInput<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    /// CHECK: Checked by the delegation program
    pub validator: Option<AccountInfo<'info>>,
    /// CHECK: PDA to delegate (capsule); seeds: [b"intent_capsule", owner]
    #[account(mut, del, seeds = [b"intent_capsule", owner.key().as_ref()], bump)]
    pub pda: AccountInfo<'info>,
    /// CHECK: PDA to delegate (vault); seeds: [b"capsule_vault", owner]
    #[account(mut, del, seeds = [b"capsule_vault", owner.key().as_ref()], bump)]
    pub vault: AccountInfo<'info>,
    /// CHECK: Magic program
    pub magic_program: AccountInfo<'info>,
    /// CHECK: Delegation program
    pub delegation_program: AccountInfo<'info>,
    /// CHECK: System program
    pub system_program: Program<'info, System>,
}


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

#[derive(Accounts)]
pub struct ScheduleExecuteIntent<'info> {
    /// CHECK: Magic program for CPI (MagicBlock crank scheduler)
    pub magic_program: AccountInfo<'info>,
    /// Payer who signs the schedule transaction (on PER/TEE RPC)
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Capsule PDA delegated to PER/ER.
    #[account(mut)]
    pub capsule: AccountInfo<'info>,
    /// CHECK: Vault PDA
    #[account(mut)]
    pub vault: AccountInfo<'info>,
    /// MagicBlock Permission Program
    /// CHECK: Validated by address
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
    /// CHECK: PDA for access control
    #[account(
        seeds = [b"permission", capsule.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub permission: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct SamplePrice<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Pyth Lazer / ephemeral oracle price feed account
    pub price_update: AccountInfo<'info>,
}

#[account]
pub struct FeeConfig {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub creation_fee_lamports: u64,
    pub execution_fee_bps: u16, // basis points, 10000 = 100%
}

impl FeeConfig {
    pub const LEN: usize = 32 + 32 + 8 + 2;
}

#[derive(Accounts)]
pub struct InitFeeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + FeeConfig::LEN,
        seeds = [b"fee_config"],
        bump
    )]
    pub fee_config: Account<'info, FeeConfig>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateFeeConfig<'info> {
    #[account(
        mut,
        seeds = [b"fee_config"],
        bump,
        constraint = fee_config.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub fee_config: Account<'info, FeeConfig>,
    
    pub authority: Signer<'info>,
}

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

#[derive(Accounts)]
pub struct UpdateIntent<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,
    
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteIntent<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", capsule.owner.as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    /// CHECK: Vault PDA
    #[account(
        mut,
        seeds = [b"capsule_vault", capsule.owner.as_ref()],
        bump = capsule.vault_bump
    )]
    pub vault: AccountInfo<'info>,

    /// MagicBlock Permission Program
    /// CHECK: Validated by address
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,

    /// CHECK: PDA for access control; seeds [b"permission", capsule]
    #[account(
        seeds = [b"permission", capsule.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub permission: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct DistributeAssets<'info> {
    #[account(
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

    /// CHECK: external CCIP router program account
    pub ccip_router: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct UpdateActivity<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,
    
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct RestartTimer<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", capsule.owner.as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,
    
    /// Can be the owner or any authorized signer/crank
    pub authority: Signer<'info>,
}


#[derive(Accounts)]
pub struct RecreateCapsule<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,
    
    #[account(
        mut,
        seeds = [b"capsule_vault", owner.key().as_ref()],
        bump = capsule.vault_bump
    )]
    pub vault: Box<Account<'info, CapsuleVault>>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}


/// Vault PDA holds SOL locked at capsule creation; anyone can trigger execute when conditions are met.
#[account]
pub struct CapsuleVault {
    pub dummy: u8, // placeholder for account discriminator + minimal data
}

impl CapsuleVault {
    pub const LEN: usize = 1;
}

#[account]
pub struct IntentCapsule {
    pub owner: Pubkey,
    pub inactivity_period: i64, // seconds
    pub last_activity: i64,      // unix timestamp
    pub intent_data: Vec<u8>,    // encoded intent instructions
    pub is_active: bool,
    pub executed_at: Option<i64>,
    pub bump: u8,
    pub vault_bump: u8, // for invoke_signed when transferring from vault
    pub mint: Pubkey,
    pub retry_count: u64, // Fail-safe: track TEE/execution retries
    pub ccip_sent_bitmap: u16, // Bitmap tracking which beneficiary indexes have had CCIP sent (max 16)
}

impl IntentCapsule {
    pub const LEN: usize = 32 + // owner
        8 +                      // inactivity_period
        8 +                      // last_activity
        4 + 1024 +               // intent_data (max 1KB)
        1 +                      // is_active
        1 + 8 +                  // executed_at (Option<i64>)
        1 +                      // bump
        1 +                      // vault_bump
        32 +                     // mint
        8 +                      // retry_count
        2;                       // ccip_sent_bitmap
}

#[event]
pub struct IntentExecuted {
    pub capsule: Pubkey,
    pub owner: Pubkey,
    pub executed_at: i64,
}

#[event]
pub struct CcipTransferRequested {
    pub capsule: Pubkey,
    pub beneficiary_index: u16,
    pub evm_address: String,
    pub destination_chain_selector: String,
    pub amount_lamports: u64,
}

#[event]
pub struct CcipTransferSent {
    pub capsule: Pubkey,
    pub beneficiary_index: u16,
    pub evm_address: String,
    pub destination_chain_selector: String,
    pub amount_lamports: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized: Only the owner can perform this action")]
    Unauthorized,
    #[msg("Capsule is not active")]
    CapsuleInactive,
    #[msg("Capsule is active")]
    CapsuleActive,
    #[msg("Capsule has not been executed")]
    CapsuleNotExecuted,
    #[msg("Inactivity period has not been met")]
    InactivityPeriodNotMet,
    #[msg("Invalid intent data format")]
    InvalidIntentData,
    #[msg("Invalid beneficiary address")]
    InvalidBeneficiaryAddress,
    #[msg("Invalid instruction data for crank")]
    InvalidInstructionData,
    #[msg("Invalid or stale price feed")]
    InvalidPriceFeed,
    #[msg("Invalid fee config or fee recipient")]
    InvalidFeeConfig,
    #[msg("Invalid token account provided")]
    InvalidTokenAccount,
    #[msg("Unsupported beneficiary chain")]
    UnsupportedBeneficiaryChain,
    #[msg("Invalid CCIP account set provided")]
    InvalidCcipAccounts,
    #[msg("CCIP transfer already sent for this beneficiary")]
    CcipAlreadySent,
}

fn infer_asset_decimals(intent_json: &serde_json::Value, mint_decimals: Option<u8>) -> u8 {
    if let Some(decimals) = mint_decimals {
        return decimals;
    }

    match intent_json
        .get("assetSymbol")
        .and_then(|symbol| symbol.as_str())
        .unwrap_or("SOL")
    {
        "BTC" | "ETH" => 8,
        _ => 9,
    }
}

/// Parse an asset amount string into atomic units using the asset decimals.
fn parse_amount_to_units(amount_str: &str, decimals: u8) -> Result<u64> {
    let amount: f64 = amount_str.parse()
        .map_err(|_| ErrorCode::InvalidIntentData)?;

    let scale = 10u64.pow(decimals as u32) as f64;
    Ok((amount * scale) as u64)
}

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

//! Distribute one asset from the Vault to the capsule's beneficiaries, split by share_bps.
//!
//! Per-asset, drain-and-close: call once per asset (None mint = native SOL). Permissionless (a
//! crank or any beneficiary can trigger it) but gated on a fired + grace-elapsed Switch, and the
//! fixed on-chain share_bps mean no caller can misdirect funds. Idempotency is structural, not a
//! flag: re-running SOL distribution finds an already-drained vault (sends nothing); re-running an
//! SPL distribution finds the vault ATA already closed (fails -> natural no-op).

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

use crate::constants::{BPS_DENOMINATOR, GRACE_PERIOD};
use crate::error::ErrorCode;
use crate::events::AssetsDistributed;
use crate::state::{BeneficiarySet, CapsuleVault, IntentCapsule};

#[derive(Accounts)]
pub struct DistributeAssets<'info> {
    #[account(
        seeds = [b"intent_capsule", capsule.owner.as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    /// The (now-revealed) beneficiary list. Must already be committed back to base
    /// (crank_undelegate_beneficiaries) - while delegated to the TEE this account is not program-owned
    /// and Anchor's Account<> owner-check would reject it, which is exactly the privacy guarantee.
    #[account(
        seeds = [b"beneficiary_set", capsule.owner.as_ref()],
        bump = capsule.beneficiaries_bump,
        constraint = beneficiary_set.owner == capsule.owner @ ErrorCode::Unauthorized,
    )]
    pub beneficiary_set: Box<Account<'info, BeneficiarySet>>,

    #[account(
        mut,
        seeds = [b"capsule_vault", capsule.owner.as_ref()],
        bump = capsule.vault_bump
    )]
    pub vault: Box<Account<'info, CapsuleVault>>,

    pub system_program: Program<'info, System>,

    // SPL leg (omit for native SOL).
    pub token_program: Option<Program<'info, Token>>,
    pub mint: Option<Box<Account<'info, Mint>>>,
    #[account(mut)]
    pub vault_token_account: Option<Box<Account<'info, TokenAccount>>>,
    // remaining_accounts: one recipient per beneficiary - SOL: the beneficiary's system account;
    // SPL: the beneficiary's ATA for `mint` (must already exist; the off-chain crank pre-creates them).
}

/// Split the asset's full current vault balance across beneficiaries by share_bps; the last
/// beneficiary absorbs any rounding remainder. SPL ATAs are closed after draining (rent to vault).
pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, DistributeAssets<'info>>) -> Result<()> {
    let capsule = &ctx.accounts.capsule;
    require!(!capsule.is_active, ErrorCode::CapsuleActive);
    let executed_at = capsule.executed_at.ok_or(ErrorCode::CapsuleNotExecuted)?;
    let now = Clock::get()?.unix_timestamp;
    // Honor the post-fire grace window: the owner may still revive during it (update_activity).
    require!(now >= executed_at + GRACE_PERIOD, ErrorCode::GracePeriodNotElapsed);
    require!(!ctx.accounts.beneficiary_set.beneficiaries.is_empty(), ErrorCode::NoBeneficiaries);

    let owner_key = capsule.owner;
    let vault_bump = capsule.vault_bump;
    let beneficiaries = &ctx.accounts.beneficiary_set.beneficiaries;
    let last_idx = beneficiaries.len() - 1;
    let vault_seeds: &[&[u8]] = &[b"capsule_vault", owner_key.as_ref(), &[vault_bump]];
    let signer_seeds = &[vault_seeds];

    if let Some(mint) = &ctx.accounts.mint {
        // ---- SPL asset ----
        let token_program = ctx.accounts.token_program.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        let vault_ata = ctx.accounts.vault_token_account.as_ref().ok_or(ErrorCode::InvalidTokenAccount)?;
        require!(
            vault_ata.key() == get_associated_token_address(&ctx.accounts.vault.key(), &mint.key()),
            ErrorCode::InvalidTokenAccount
        );
        let pool = vault_ata.amount;
        require!(pool > 0, ErrorCode::NothingToDistribute);

        let mut distributed: u64 = 0;
        for (idx, b) in beneficiaries.iter().enumerate() {
            let to_send = if idx == last_idx {
                pool.saturating_sub(distributed)
            } else {
                ((pool as u128) * (b.share_bps as u128) / (BPS_DENOMINATOR as u128)) as u64
            };
            if to_send == 0 {
                continue;
            }
            let expected_ata = get_associated_token_address(&b.pubkey, &mint.key());
            let recipient_ata = ctx
                .remaining_accounts
                .iter()
                .find(|acc| acc.key() == expected_ata)
                .ok_or(ErrorCode::InvalidBeneficiaryAddress)?;

            let cpi_accounts = Transfer {
                from: vault_ata.to_account_info(),
                to: recipient_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(token_program.to_account_info(), cpi_accounts, signer_seeds),
                to_send,
            )?;
            distributed = distributed.saturating_add(to_send);
        }

        // Drain-and-close: reclaim the emptied ATA's rent to the vault (swept by the SOL pass).
        let close_accounts = CloseAccount {
            account: vault_ata.to_account_info(),
            destination: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        token::close_account(CpiContext::new_with_signer(
            token_program.to_account_info(),
            close_accounts,
            signer_seeds,
        ))?;

        emit!(AssetsDistributed {
            capsule: capsule.key(),
            owner: owner_key,
            mint: mint.key(),
            total: pool,
        });
        msg!("Distributed {} of mint {:?} across {} beneficiaries", pool, mint.key(), beneficiaries.len());
    } else {
        // ---- native SOL ----
        let vault_ai = ctx.accounts.vault.to_account_info();
        let rent_floor = Rent::get()?.minimum_balance(vault_ai.data_len());
        let available = vault_ai.lamports().saturating_sub(rent_floor);
        require!(available > 0, ErrorCode::NothingToDistribute);

        let mut distributed: u64 = 0;
        for (idx, b) in beneficiaries.iter().enumerate() {
            let to_send = if idx == last_idx {
                available.saturating_sub(distributed)
            } else {
                ((available as u128) * (b.share_bps as u128) / (BPS_DENOMINATOR as u128)) as u64
            };
            if to_send == 0 {
                continue;
            }
            let recipient = ctx
                .remaining_accounts
                .iter()
                .find(|acc| acc.key() == b.pubkey)
                .ok_or(ErrorCode::InvalidBeneficiaryAddress)?;

            **vault_ai.try_borrow_mut_lamports()? -= to_send;
            **recipient.to_account_info().try_borrow_mut_lamports()? += to_send;
            distributed = distributed.saturating_add(to_send);
        }

        emit!(AssetsDistributed {
            capsule: capsule.key(),
            owner: owner_key,
            mint: Pubkey::default(),
            total: available,
        });
        msg!("Distributed {} lamports across {} beneficiaries", available, beneficiaries.len());
    }

    Ok(())
}

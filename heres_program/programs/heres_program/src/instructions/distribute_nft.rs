//! Transfer one standard, uncompressed SPL NFT to its explicitly assigned recipient.
//!
//! This path is intentionally separate from proportional fungible distribution. An NFT balance is
//! one indivisible base unit; applying basis-point rounding would send it to whichever beneficiary
//! happened to be last. The assignment is instead authorized by the revealed TEE BeneficiarySet.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::ErrorCode;
use crate::events::NftDistributed;
use crate::state::{BeneficiarySet, CapsuleVault, IntentCapsule};

#[derive(Accounts)]
pub struct DistributeNft<'info> {
    #[account(
        seeds = [b"intent_capsule", capsule.owner.as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

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

    pub token_program: Interface<'info, TokenInterface>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub recipient_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
}

pub fn handler(ctx: Context<DistributeNft>, recipient: Pubkey) -> Result<()> {
    let capsule = &ctx.accounts.capsule;
    require!(!capsule.is_active, ErrorCode::CapsuleActive);
    require!(capsule.executed_at.is_some(), ErrorCode::CapsuleNotExecuted);
    if capsule.requires_config_commitment() {
        require!(
            ctx.accounts.beneficiary_set.requires_seal()
                && ctx.accounts.beneficiary_set.is_sealed(),
            ErrorCode::InheritanceNotSealed
        );
        require!(
            capsule.config_commitment() == ctx.accounts.beneficiary_set.config_commitment(),
            ErrorCode::InvalidConfigurationCommitment
        );
    }

    let mint = &ctx.accounts.mint;
    require!(
        mint.decimals == 0 && mint.supply == 1,
        ErrorCode::InvalidNftMint
    );
    require!(
        recipient != Pubkey::default(),
        ErrorCode::InvalidNftAssignment
    );
    require!(
        ctx.accounts
            .beneficiary_set
            .nft_assignments
            .iter()
            .any(|assignment| assignment.mint == mint.key() && assignment.recipient == recipient),
        ErrorCode::NftAssignmentNotFound
    );

    let token_program_id = ctx.accounts.token_program.key();
    require!(
        mint.to_account_info().owner == &token_program_id,
        ErrorCode::InvalidTokenAccount
    );
    let vault_ata = &ctx.accounts.vault_token_account;
    let recipient_ata = &ctx.accounts.recipient_token_account;
    require!(
        vault_ata.key()
            == get_associated_token_address_with_program_id(
                &ctx.accounts.vault.key(),
                &mint.key(),
                &token_program_id,
            )
            && vault_ata.mint == mint.key()
            && vault_ata.owner == ctx.accounts.vault.key()
            && vault_ata.amount == 1,
        ErrorCode::InvalidTokenAccount
    );
    require!(
        recipient_ata.key()
            == get_associated_token_address_with_program_id(
                &recipient,
                &mint.key(),
                &token_program_id
            )
            && recipient_ata.mint == mint.key()
            && recipient_ata.owner == recipient,
        ErrorCode::InvalidTokenAccount
    );

    let owner_key = capsule.owner;
    let vault_seeds: &[&[u8]] = &[b"capsule_vault", owner_key.as_ref(), &[capsule.vault_bump]];
    let signer_seeds = &[vault_seeds];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: vault_ata.to_account_info(),
                mint: mint.to_account_info(),
                to: recipient_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        1,
        0,
    )?;

    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: vault_ata.to_account_info(),
            destination: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        },
        signer_seeds,
    ))?;
    ctx.accounts.vault.unregister_token_asset();

    emit!(NftDistributed {
        capsule: capsule.key(),
        owner: owner_key,
        mint: mint.key(),
        recipient,
    });
    msg!("Distributed NFT {:?} to {:?}", mint.key(), recipient);
    Ok(())
}

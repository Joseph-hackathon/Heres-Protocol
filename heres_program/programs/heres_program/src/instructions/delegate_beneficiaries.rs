//! Delegate the BeneficiarySet to the MagicBlock Private ER (TEE), behind a PER permission.
//!
//! This is the ONLY account that needs enclave privacy. For a Private ER the delegated account is
//! gated by a *permission account* that controls who may read/interact with it inside the TEE. We
//! create that permission with a SINGLE member - the owner, full visibility + authority - and delegate
//! it alongside the BeneficiarySet. Unlike the old single-account model, there is NO interact-only
//! relayer member here: the relayer only ever bumps liveness on the regular-ER Switch and never
//! touches this account, so it needs no presence in the enclave at all.
//!
//! Delegating the permission account too means owner member edits run on the ER in ms, not base
//! round-trips. The beneficiary list itself is set/edited via update_intent routed to the TEE.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::{
    CreatePermissionCpiBuilder, DelegatePermissionCpiBuilder,
};
use ephemeral_rollups_sdk::access_control::structs::{
    Member, MembersArgs, ACCOUNT_SIGNATURES_FLAG, AUTHORITY_FLAG, PERMISSION_SEED,
    TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::anchor::{delegate, DelegationProgram};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::pda::{
    DELEGATE_BUFFER_TAG, DELEGATION_METADATA_TAG, DELEGATION_RECORD_TAG,
};

use crate::constants::{PERMISSION_PROGRAM_ID, TEE_VALIDATOR};

/// Owner sees everything inside the enclave and can manage the permission.
const OWNER_FLAGS: u8 =
    AUTHORITY_FLAG | TX_LOGS_FLAG | TX_BALANCES_FLAG | TX_MESSAGE_FLAG | ACCOUNT_SIGNATURES_FLAG;

#[delegate]
#[derive(Accounts)]
pub struct DelegateBeneficiariesInput<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    /// CHECK: checked by the delegation program. Defaults to the TEE validator.
    pub validator: Option<AccountInfo<'info>>,
    /// CHECK: the BeneficiarySet PDA to delegate; seeds [b"beneficiary_set", owner].
    #[account(mut, del, seeds = [b"beneficiary_set", owner.key().as_ref()], bump)]
    pub pda: AccountInfo<'info>,
    /// CHECK: retained for the stable client ABI. Base-layer delegation does not invoke the Magic
    /// Program, which is only executable inside an ER, so it must not be executable-checked here.
    pub magic_program: AccountInfo<'info>,
    pub delegation_program: Program<'info, DelegationProgram>,
    pub system_program: Program<'info, System>,

    // ---- PER permission lifecycle (access control inside the TEE) ----
    /// CHECK: MagicBlock Permission Program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
    /// CHECK: permission PDA [b"permission:", beneficiary_set] under the permission program; created if empty.
    #[account(
        mut,
        seeds = [PERMISSION_SEED, pda.key().as_ref()],
        bump,
        seeds::program = permission_program.key()
    )]
    pub permission: AccountInfo<'info>,
    /// CHECK: delegation buffer for the permission account.
    #[account(
        mut,
        seeds = [DELEGATE_BUFFER_TAG, permission.key().as_ref()],
        bump,
        seeds::program = permission_program.key()
    )]
    pub buffer_permission: AccountInfo<'info>,
    /// CHECK: delegation record for the permission account.
    // Keep the canonical ID expression here. SDK 0.15.5's #[delegate] macro treats lowercase
    // "del" anywhere in an account attribute as its marker, so delegation_program.key() corrupts
    // the generated constraint even though both expressions resolve to the same program ID.
    #[account(
        mut,
        seeds = [DELEGATION_RECORD_TAG, permission.key().as_ref()],
        bump,
        seeds::program = ephemeral_rollups_sdk::id()
    )]
    pub delegation_record_permission: AccountInfo<'info>,
    /// CHECK: delegation metadata for the permission account.
    #[account(
        mut,
        seeds = [DELEGATION_METADATA_TAG, permission.key().as_ref()],
        bump,
        seeds::program = ephemeral_rollups_sdk::id()
    )]
    pub delegation_metadata_permission: AccountInfo<'info>,
}

/// Create + delegate the PER permission (owner-only member), then delegate the BeneficiarySet to the
/// TEE. Idempotent (each step is skipped if already done), so a re-run after a partial failure is safe.
pub fn handler(ctx: Context<DelegateBeneficiariesInput>) -> Result<()> {
    let validator_key = ctx
        .accounts
        .validator
        .as_ref()
        .map(|v| v.key())
        .unwrap_or(TEE_VALIDATOR);
    let owner_key = ctx.accounts.owner.key();
    let set_bump = ctx.bumps.pda;
    let set_seeds: &[&[u8]] = &[b"beneficiary_set", owner_key.as_ref(), &[set_bump]];

    let members = vec![Member {
        flags: OWNER_FLAGS,
        pubkey: owner_key,
    }];

    let payer_ai = ctx.accounts.payer.to_account_info();
    let system_ai = ctx.accounts.system_program.to_account_info();

    // 1. Create the permission account (the BeneficiarySet PDA signs its own permission into existence).
    if ctx.accounts.permission.data_is_empty() {
        msg!(
            "Creating PER permission for BeneficiarySet ({} member)",
            members.len()
        );
        CreatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
            .permissioned_account(&ctx.accounts.pda)
            .permission(&ctx.accounts.permission)
            .payer(&payer_ai)
            .system_program(&system_ai)
            .args(MembersArgs {
                members: Some(members),
            })
            .invoke_signed(&[set_seeds])?;
    }

    // 2. Delegate the permission account itself so owner member edits run on the ER.
    if ctx.accounts.permission.owner != &ephemeral_rollups_sdk::id() {
        msg!("Delegating BeneficiarySet PER permission account");
        DelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
            .payer(&payer_ai)
            .authority(&ctx.accounts.pda, false)
            .permissioned_account(&ctx.accounts.pda, true)
            .permission(&ctx.accounts.permission)
            .system_program(&system_ai)
            .owner_program(&ctx.accounts.permission_program)
            .delegation_buffer(&ctx.accounts.buffer_permission)
            .delegation_record(&ctx.accounts.delegation_record_permission)
            .delegation_metadata(&ctx.accounts.delegation_metadata_permission)
            .delegation_program(&ctx.accounts.delegation_program)
            .validator(ctx.accounts.validator.as_ref())
            .invoke_signed(&[set_seeds])?;
    }

    // 3. Delegate the BeneficiarySet to the TEE.
    if ctx.accounts.pda.owner != &ephemeral_rollups_sdk::id() {
        msg!(
            "Delegating BeneficiarySet to TEE (validator {:?})",
            validator_key
        );
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[b"beneficiary_set", owner_key.as_ref()],
            DelegateConfig {
                commit_frequency_ms: 0,
                validator: Some(validator_key),
            },
        )?;
    }
    msg!("BeneficiarySet + permission delegated to TEE");
    Ok(())
}

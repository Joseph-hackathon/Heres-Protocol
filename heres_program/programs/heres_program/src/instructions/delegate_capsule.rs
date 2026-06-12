//! Delegate the Switch (capsule PDA) to the MagicBlock Private ER (TEE), behind a PER permission.
//!
//! For a Private Ephemeral Rollup the delegated account is gated by a *permission account* that
//! controls who may interact with / read it inside the TEE. We create that permission with two
//! members and delegate it alongside the Switch:
//!   - owner: full visibility + authority (can read the private beneficiary list, manage members);
//!   - heartbeat relayer: interact only, NO read flags, so it can bump liveness on the ER without
//!     ever seeing the beneficiaries (redesign D8 / Open Q7).
//! Delegating the permission account too means member edits run on the ER in ms, not base round-trips.
//!
//! Only the Switch is delegated; the Vault stays on the base layer the whole time. That keeps funds
//! base-recoverable via recover_vault even if the validator dies, and makes multi-asset orthogonal
//! to delegation (token accounts are never delegated).

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::{
    CreatePermissionCpiBuilder, DelegatePermissionCpiBuilder,
};
use ephemeral_rollups_sdk::access_control::structs::{
    Member, MembersArgs, ACCOUNT_SIGNATURES_FLAG, AUTHORITY_FLAG, TX_BALANCES_FLAG, TX_LOGS_FLAG,
    TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::{PERMISSION_PROGRAM_ID, TEE_VALIDATOR};
use crate::state::IntentCapsule;

/// Owner sees everything and can manage the permission.
const OWNER_FLAGS: u8 =
    AUTHORITY_FLAG | TX_LOGS_FLAG | TX_BALANCES_FLAG | TX_MESSAGE_FLAG | ACCOUNT_SIGNATURES_FLAG;
/// Relayer can interact (submit update_activity) but the TEE reveals nothing to it - no read flags.
const RELAYER_FLAGS: u8 = 0;

#[delegate]
#[derive(Accounts)]
pub struct DelegateCapsuleInput<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub owner: Signer<'info>,
    /// CHECK: checked by the delegation program.
    pub validator: Option<AccountInfo<'info>>,
    /// CHECK: the Switch PDA to delegate; seeds [b"intent_capsule", owner].
    #[account(mut, del, seeds = [b"intent_capsule", owner.key().as_ref()], bump)]
    pub pda: AccountInfo<'info>,
    /// CHECK: Magic program.
    pub magic_program: AccountInfo<'info>,
    /// CHECK: Delegation program.
    pub delegation_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,

    // ---- PER permission lifecycle (access control inside the TEE) ----
    /// CHECK: MagicBlock Permission Program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
    /// CHECK: permission PDA [b"permission:", capsule] under the permission program; created if empty.
    #[account(mut)]
    pub permission: AccountInfo<'info>,
    /// CHECK: delegation buffer for the permission account.
    #[account(mut)]
    pub buffer_permission: AccountInfo<'info>,
    /// CHECK: delegation record for the permission account.
    #[account(mut)]
    pub delegation_record_permission: AccountInfo<'info>,
    /// CHECK: delegation metadata for the permission account.
    #[account(mut)]
    pub delegation_metadata_permission: AccountInfo<'info>,
}

/// Create + delegate the PER permission, then delegate the Switch. Idempotent (each step is skipped
/// if already done), so a re-run after a partial failure is safe.
pub fn handler(ctx: Context<DelegateCapsuleInput>) -> Result<()> {
    let validator_key = ctx
        .accounts
        .validator
        .as_ref()
        .map(|v| v.key())
        .unwrap_or(TEE_VALIDATOR);
    let owner_key = ctx.accounts.owner.key();
    let capsule_bump = ctx.bumps.pda;
    let capsule_seeds: &[&[u8]] = &[b"intent_capsule", owner_key.as_ref(), &[capsule_bump]];

    // Read the heartbeat authority from the still-program-owned Switch (pre-delegation) to set it as
    // the interact-only member.
    let heartbeat_authority = {
        let data = ctx.accounts.pda.try_borrow_data()?;
        IntentCapsule::try_deserialize(&mut &data[..])?.heartbeat_authority
    };
    let members = vec![
        Member { flags: OWNER_FLAGS, pubkey: owner_key },
        Member { flags: RELAYER_FLAGS, pubkey: heartbeat_authority },
    ];

    let payer_ai = ctx.accounts.payer.to_account_info();
    let system_ai = ctx.accounts.system_program.to_account_info();

    // 1. Create the permission account (the Switch PDA signs its own permission into existence).
    if ctx.accounts.permission.data_is_empty() {
        msg!("Creating PER permission ({} members)", members.len());
        CreatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
            .permissioned_account(&ctx.accounts.pda)
            .permission(&ctx.accounts.permission)
            .payer(&payer_ai)
            .system_program(&system_ai)
            .args(MembersArgs { members: Some(members) })
            .invoke_signed(&[capsule_seeds])?;
    }

    // 2. Delegate the permission account itself so member edits run on the ER.
    if ctx.accounts.permission.owner != &ephemeral_rollups_sdk::id() {
        msg!("Delegating PER permission account");
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
            .invoke_signed(&[capsule_seeds])?;
    }

    // 3. Delegate the Switch.
    if ctx.accounts.pda.owner != &ephemeral_rollups_sdk::id() {
        msg!("Delegating Switch to PER (validator {:?})", validator_key);
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[b"intent_capsule", owner_key.as_ref()],
            DelegateConfig {
                commit_frequency_ms: 0,
                validator: Some(validator_key),
            },
        )?;
    }
    msg!("Switch + permission delegated to PER");
    Ok(())
}

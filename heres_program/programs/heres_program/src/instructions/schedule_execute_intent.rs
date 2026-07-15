//! Register a MagicBlock ScheduleTask crank that re-runs execute_intent at intervals on the ER.
//!
//! The Switch is on a regular ER (no PER permission) and execute_intent is flip-only, so the
//! scheduled inner ix references ONLY the Switch.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use ephemeral_rollups_sdk::anchor::MagicProgram;
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;
use magicblock_magic_program_api::{args::ScheduleTaskArgs, instruction::MagicBlockInstruction};

use crate::error::ErrorCode;
use crate::state::IntentCapsule;

/// Anchor discriminator for execute_intent (no args). Name-derived (sha256("global:execute_intent")),
/// so it stays valid across program-id / deploy changes as long as the instruction keeps its name.
const EXECUTE_INTENT_DISCRIMINATOR: [u8; 8] = [53, 130, 47, 154, 227, 220, 122, 212];

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ScheduleExecuteIntentArgs {
    pub task_id: u64,
    pub execution_interval_millis: u64,
    pub iterations: u64,
}

#[derive(Accounts)]
pub struct ScheduleExecuteIntent<'info> {
    pub magic_program: Program<'info, MagicProgram>,
    /// Payer who signs the schedule transaction (on the ER RPC).
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Switch PDA delegated to the regular ER. New-version capsules can only be scheduled after the
    /// sealed configuration commitment has been armed.
    #[account(
        mut,
        seeds = [b"intent_capsule", capsule.owner.as_ref()],
        bump = capsule.bump,
        constraint = capsule.owner == payer.key() @ ErrorCode::Unauthorized,
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,
}

/// Schedule a crank that runs execute_intent at intervals (MagicBlock ScheduleTask). The Vault is
/// not delegated and execute_intent is flip-only, so the inner ix references only the Switch.
pub fn handler(ctx: Context<ScheduleExecuteIntent>, args: ScheduleExecuteIntentArgs) -> Result<()> {
    require!(ctx.accounts.capsule.is_active, ErrorCode::CapsuleInactive);
    if ctx.accounts.capsule.requires_config_commitment() {
        require!(
            ctx.accounts.capsule.has_config_commitment(),
            ErrorCode::InheritanceNotSealed
        );
    }
    msg!(
        "Scheduling execute_intent crank for capsule: {:?}",
        ctx.accounts.capsule.key()
    );

    let inner_accounts = vec![AccountMeta::new(ctx.accounts.capsule.key(), false)];
    let execute_ix = Instruction {
        program_id: crate::ID,
        accounts: inner_accounts,
        data: EXECUTE_INTENT_DISCRIMINATOR.to_vec(),
    };

    let task_id = i64::try_from(args.task_id).map_err(|_| ErrorCode::InvalidInstructionData)?;
    let execution_interval_millis = i64::try_from(args.execution_interval_millis)
        .map_err(|_| ErrorCode::InvalidInstructionData)?;
    let iterations =
        i64::try_from(args.iterations).map_err(|_| ErrorCode::InvalidInstructionData)?;
    require!(
        execution_interval_millis > 0 && iterations > 0,
        ErrorCode::InvalidInstructionData
    );

    let ix_data = bincode::serialize(&MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
        task_id,
        execution_interval_millis,
        iterations,
        instructions: vec![execute_ix],
    }))
    .map_err(|e| {
        msg!("ERROR: failed to serialize ScheduleTask args: {:?}", e);
        ErrorCode::InvalidInstructionData
    })?;

    // The ScheduleTask CPI must include every account the inner execute_intent references.
    let schedule_ix = Instruction::new_with_bytes(
        MAGIC_PROGRAM_ID,
        &ix_data,
        vec![
            AccountMeta::new(ctx.accounts.payer.key(), true),
            AccountMeta::new(ctx.accounts.capsule.key(), false),
        ],
    );

    invoke_signed(
        &schedule_ix,
        &[
            ctx.accounts.magic_program.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.capsule.to_account_info(),
        ],
        &[],
    )?;

    msg!("Scheduled execute_intent crank: task_id={}", args.task_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_values_must_fit_signed_api() {
        assert!(i64::try_from(i64::MAX as u64).is_ok());
        assert!(i64::try_from((i64::MAX as u64) + 1).is_err());
        assert!(i64::try_from(u64::MAX).is_err());
    }

    #[allow(dead_code)]
    fn schedule_program_is_pinned(ctx: &ScheduleExecuteIntent<'_>) {
        let _: &Program<'_, MagicProgram> = &ctx.magic_program;
    }
}

//! Register a MagicBlock ScheduleTask crank that re-runs execute_intent at intervals on the ER.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;
use magicblock_magic_program_api::{args::ScheduleTaskArgs, instruction::MagicBlockInstruction};

use crate::constants::PERMISSION_PROGRAM_ID;
use crate::error::ErrorCode;

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
    /// CHECK: Magic program for the ScheduleTask CPI.
    pub magic_program: AccountInfo<'info>,
    /// Payer who signs the schedule transaction (on the PER/TEE RPC).
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Switch PDA delegated to PER/ER.
    #[account(mut)]
    pub capsule: AccountInfo<'info>,
    /// MagicBlock Permission Program.
    /// CHECK: validated by address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
    /// CHECK: PER access-control PDA; SDK seed is [b"permission:", capsule] (PERMISSION_SEED).
    #[account(
        seeds = [b"permission:", capsule.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub permission: AccountInfo<'info>,
}

/// Schedule a crank that runs execute_intent at intervals (MagicBlock ScheduleTask). The Vault is
/// not delegated and execute_intent is flip-only, so the inner ix references only the Switch + the
/// two PER access-control accounts.
pub fn handler(ctx: Context<ScheduleExecuteIntent>, args: ScheduleExecuteIntentArgs) -> Result<()> {
    msg!("Scheduling execute_intent crank for capsule: {:?}", ctx.accounts.capsule.key());

    let inner_accounts = vec![
        AccountMeta::new(ctx.accounts.capsule.key(), false),
        AccountMeta::new_readonly(ctx.accounts.permission_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.permission.key(), false),
    ];
    let execute_ix = Instruction {
        program_id: crate::ID,
        accounts: inner_accounts,
        data: EXECUTE_INTENT_DISCRIMINATOR.to_vec(),
    };

    let ix_data = bincode::serialize(&MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
        task_id: args.task_id as i64,
        execution_interval_millis: args.execution_interval_millis as i64,
        iterations: args.iterations as i64,
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
            ctx.accounts.permission_program.to_account_info(),
            ctx.accounts.permission.to_account_info(),
        ],
        &[],
    )?;

    msg!("Scheduled execute_intent crank: task_id={}", args.task_id);
    Ok(())
}

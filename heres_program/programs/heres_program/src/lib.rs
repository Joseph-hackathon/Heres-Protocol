use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

// Bring each instruction's Accounts context + Anchor-generated client modules
// (`__client_accounts_*`) into the crate root so the #[program] dispatcher can resolve
// them. Private (no re-export) to avoid glob ambiguity with the generated dispatcher.
use instructions::cancel_capsule::*;
use instructions::crank_undelegate::*;
use instructions::create_capsule::*;
use instructions::delegate_capsule::*;
use instructions::distribute_assets::*;
use instructions::execute_intent::*;
use instructions::init_fee_config::*;
use instructions::prepare_private_distribution::*;
use instructions::recreate_capsule::*;
use instructions::restart_timer::*;
use instructions::sample_price::*;
use instructions::schedule_execute_intent::*;
use instructions::send_ccip_from_vault::*;
use instructions::update_activity::*;
use instructions::update_fee_config::*;
use instructions::update_intent::*;

declare_id!("AmiL7vEZ2SpAuDXzdxC3sJMyjZqgacvwvvQdT3qosmsW");

#[ephemeral]
#[program]
pub mod heres_program {
    use super::*;

    /// Initialize platform fee config (call once after deploy; only authority can update later).
    pub fn init_fee_config(
        ctx: Context<InitFeeConfig>,
        fee_recipient: Pubkey,
        creation_fee_lamports: u64,
        execution_fee_bps: u16,
    ) -> Result<()> {
        instructions::init_fee_config::handler(ctx, fee_recipient, creation_fee_lamports, execution_fee_bps)
    }

    /// Update platform fee config (authority only).
    pub fn update_fee_config(
        ctx: Context<UpdateFeeConfig>,
        creation_fee_lamports: u64,
        execution_fee_bps: u16,
    ) -> Result<()> {
        instructions::update_fee_config::handler(ctx, creation_fee_lamports, execution_fee_bps)
    }

    /// Initialize a new Intent Capsule (SOL/SPL locked in vault; anyone can execute when conditions are met).
    pub fn create_capsule(
        ctx: Context<CreateCapsule>,
        inactivity_period: i64,
        intent_data: Vec<u8>,
    ) -> Result<()> {
        instructions::create_capsule::handler(ctx, inactivity_period, intent_data)
    }

    /// Update the intent data of an existing capsule.
    pub fn update_intent(ctx: Context<UpdateIntent>, new_intent_data: Vec<u8>) -> Result<()> {
        instructions::update_intent::handler(ctx, new_intent_data)
    }

    /// Cancel an active capsule (owner-only): refund all locked assets and close the accounts.
    pub fn cancel_capsule(ctx: Context<CancelCapsule>) -> Result<()> {
        instructions::cancel_capsule::handler(ctx)
    }

    /// Recreate (reuse) an executed capsule with a new intent and freshly locked assets (owner-only).
    pub fn recreate_capsule(
        ctx: Context<RecreateCapsule>,
        inactivity_period: i64,
        intent_data: Vec<u8>,
    ) -> Result<()> {
        instructions::recreate_capsule::handler(ctx, inactivity_period, intent_data)
    }

    /// Execute the intent when the inactivity period is met (permissionless).
    pub fn execute_intent(ctx: Context<ExecuteIntent>) -> Result<()> {
        instructions::execute_intent::handler(ctx)
    }

    /// Reset the inactivity timer (fail-safe / auto-restart).
    pub fn restart_timer(ctx: Context<RestartTimer>) -> Result<()> {
        instructions::restart_timer::handler(ctx)
    }

    /// Distribute assets from the vault to beneficiaries (base layer, after execute_intent).
    pub fn distribute_assets<'info>(
        ctx: Context<'_, '_, '_, 'info, DistributeAssets<'info>>,
    ) -> Result<()> {
        instructions::distribute_assets::handler(ctx)
    }

    /// Send a queued EVM beneficiary transfer through the CCIP Router from vault custody.
    pub fn send_ccip_from_vault<'info>(
        ctx: Context<'_, '_, '_, 'info, SendCcipFromVault<'info>>,
        beneficiary_index: u16,
    ) -> Result<()> {
        instructions::send_ccip_from_vault::handler(ctx, beneficiary_index)
    }

    /// Update last activity timestamp (called by Helius webhook or user).
    pub fn update_activity(ctx: Context<UpdateActivity>) -> Result<()> {
        instructions::update_activity::handler(ctx)
    }

    /// Delegate capsule + vault PDAs to the MagicBlock ER/PER.
    pub fn delegate_capsule(ctx: Context<DelegateCapsuleInput>) -> Result<()> {
        instructions::delegate_capsule::handler(ctx)
    }

    /// Commit ER state and undelegate capsule + vault back to the base layer (crank-callable).
    pub fn crank_undelegate(ctx: Context<CrankUndelegateInput>) -> Result<()> {
        instructions::crank_undelegate::handler(ctx)
    }

    /// Register a MagicBlock ScheduleTask crank that re-runs execute_intent at intervals.
    pub fn schedule_execute_intent(
        ctx: Context<ScheduleExecuteIntent>,
        args: ScheduleExecuteIntentArgs,
    ) -> Result<()> {
        instructions::schedule_execute_intent::handler(ctx, args)
    }

    /// Read a Pyth Lazer / ephemeral oracle price feed (gated behind the `oracle` feature).
    pub fn sample_price(ctx: Context<SamplePrice>) -> Result<()> {
        instructions::sample_price::handler(ctx)
    }

    /// Prepare private distribution: move remaining vault funds to the distributor (crank-driven).
    pub fn prepare_private_distribution(ctx: Context<PreparePrivateDistribution>) -> Result<()> {
        instructions::prepare_private_distribution::handler(ctx)
    }
}

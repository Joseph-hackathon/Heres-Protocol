use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

// Bring each instruction's Accounts context + Anchor-generated client modules into the crate root
// so the #[program] dispatcher can resolve them. Private (no re-export) to avoid glob ambiguity.
use instructions::cancel_capsule::*;
use instructions::crank_undelegate::*;
use instructions::create_capsule::*;
use instructions::delegate_capsule::*;
use instructions::deposit::*;
use instructions::distribute_assets::*;
use instructions::execute_intent::*;
use instructions::init_fee_config::*;
use instructions::recover_vault::*;
use instructions::recreate_capsule::*;
use instructions::schedule_execute_intent::*;
use instructions::update_activity::*;
use instructions::update_fee_config::*;
use instructions::update_intent::*;

use state::Beneficiary;

declare_id!("2fLojZpdmXLeg2ZXRCXVsqiWnbpF2yFH1SVGS77UC8s3");

#[ephemeral]
#[program]
pub mod heres_program {
    use super::*;

    /// Initialize the platform fee config (call once after deploy; authority = deployer).
    pub fn init_fee_config(
        ctx: Context<InitFeeConfig>,
        fee_recipient: Pubkey,
        creation_fee_lamports: u64,
    ) -> Result<()> {
        instructions::init_fee_config::handler(ctx, fee_recipient, creation_fee_lamports)
    }

    /// Update the platform creation fee (authority only).
    pub fn update_fee_config(ctx: Context<UpdateFeeConfig>, creation_fee_lamports: u64) -> Result<()> {
        instructions::update_fee_config::handler(ctx, creation_fee_lamports)
    }

    /// Create the Switch + Vault for an owner (liveness + heartbeat authority + creation fee).
    pub fn create_capsule(
        ctx: Context<CreateCapsule>,
        inactivity_period: i64,
        heartbeat_authority: Pubkey,
    ) -> Result<()> {
        instructions::create_capsule::handler(ctx, inactivity_period, heartbeat_authority)
    }

    /// Set or replace the private beneficiary list (owner only; route via the PER once delegated).
    pub fn update_intent(ctx: Context<UpdateIntent>, beneficiaries: Vec<Beneficiary>) -> Result<()> {
        instructions::update_intent::handler(ctx, beneficiaries)
    }

    /// Lock SOL or SPL into the Vault (repeatable; owner only).
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    /// Cancel an active capsule (owner only): refund assets and close the accounts.
    pub fn cancel_capsule(ctx: Context<CancelCapsule>) -> Result<()> {
        instructions::cancel_capsule::handler(ctx)
    }

    /// Reuse an executed capsule by resetting its lifecycle in place (owner only).
    pub fn recreate_capsule(ctx: Context<RecreateCapsule>, inactivity_period: i64) -> Result<()> {
        instructions::recreate_capsule::handler(ctx, inactivity_period)
    }

    /// Fire the Switch when the inactivity period elapses (permissionless; state-only).
    pub fn execute_intent(ctx: Context<ExecuteIntent>) -> Result<()> {
        instructions::execute_intent::handler(ctx)
    }

    /// Proof-of-life: bump last_activity or revive during grace (owner OR heartbeat authority).
    pub fn update_activity(ctx: Context<UpdateActivity>) -> Result<()> {
        instructions::update_activity::handler(ctx)
    }

    /// Distribute one asset from the Vault to beneficiaries by share_bps (base layer, post-grace).
    pub fn distribute_assets<'info>(
        ctx: Context<'_, '_, '_, 'info, DistributeAssets<'info>>,
    ) -> Result<()> {
        instructions::distribute_assets::handler(ctx)
    }

    /// Owner escape hatch: recover one Vault asset while active, without touching the Switch.
    pub fn recover_vault(ctx: Context<RecoverVault>) -> Result<()> {
        instructions::recover_vault::handler(ctx)
    }

    /// Delegate the Switch to the MagicBlock ER/PER.
    pub fn delegate_capsule(ctx: Context<DelegateCapsuleInput>) -> Result<()> {
        instructions::delegate_capsule::handler(ctx)
    }

    /// Commit ER state and undelegate the Switch back to the base layer (crank-callable).
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
}

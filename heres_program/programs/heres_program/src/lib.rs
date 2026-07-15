use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

// Bring each instruction's Accounts context + Anchor-generated client modules into the crate root
// so the #[program] dispatcher can resolve them. Private (no re-export) to avoid glob ambiguity.
use instructions::arm_capsule::*;
use instructions::cancel_capsule::*;
use instructions::crank_undelegate::*;
use instructions::crank_undelegate_beneficiaries::*;
use instructions::create_capsule::*;
use instructions::delegate_beneficiaries::*;
use instructions::delegate_capsule::*;
use instructions::deposit::*;
use instructions::distribute_assets::*;
use instructions::distribute_nft::*;
use instructions::execute_intent::*;
use instructions::finalize_capsule::*;
use instructions::init_fee_config::*;
use instructions::recover_vault::*;
use instructions::schedule_execute_intent::*;
use instructions::seal_inheritance::*;
use instructions::update_activity::*;
use instructions::update_fee_config::*;
use instructions::update_intent::*;
use instructions::update_nft_assignments::*;

use state::{Beneficiary, NftAssignment};

declare_id!("sDRdG2qt6MKDB5Byfx7oqQLnZTDa32k1qM3hDSBmQUz");

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
    pub fn update_fee_config(
        ctx: Context<UpdateFeeConfig>,
        creation_fee_lamports: u64,
    ) -> Result<()> {
        instructions::update_fee_config::handler(ctx, creation_fee_lamports)
    }

    /// Create the Switch + Vault for an owner (liveness + heartbeat authority + creation fee).
    pub fn create_capsule(
        ctx: Context<CreateCapsule>,
        inactivity_period: i64,
        heartbeat_authority: Pubkey,
        target_date: Option<i64>,
    ) -> Result<()> {
        instructions::create_capsule::handler(
            ctx,
            inactivity_period,
            heartbeat_authority,
            target_date,
        )
    }

    /// Set or replace the private beneficiary list (owner only; route via the PER once delegated).
    pub fn update_intent(
        ctx: Context<UpdateIntent>,
        beneficiaries: Vec<Beneficiary>,
    ) -> Result<()> {
        instructions::update_intent::handler(ctx, beneficiaries)
    }

    /// Set or replace private per-NFT recipients (owner only; route via the PER once delegated).
    pub fn update_nft_assignments(
        ctx: Context<UpdateNftAssignments>,
        assignments: Vec<NftAssignment>,
    ) -> Result<()> {
        instructions::update_nft_assignments::handler(ctx, assignments)
    }

    /// Seal the private inheritance configuration inside the TEE before the Switch is armed.
    pub fn seal_inheritance(
        ctx: Context<SealInheritance>,
        salt: [u8; 32],
        expected_commitment: [u8; 32],
    ) -> Result<()> {
        instructions::seal_inheritance::handler(ctx, salt, expected_commitment)
    }

    /// Arm a draft Switch on the regular ER with the sealed inheritance commitment.
    pub fn arm_capsule(ctx: Context<ArmCapsule>, config_commitment: [u8; 32]) -> Result<()> {
        instructions::arm_capsule::handler(ctx, config_commitment)
    }

    /// Lock SOL or SPL into the Vault (repeatable; owner only).
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    /// Cancel an active capsule (owner only): refund assets and close the accounts.
    pub fn cancel_capsule(ctx: Context<CancelCapsule>) -> Result<()> {
        instructions::cancel_capsule::handler(ctx)
    }

    /// Fire the Switch when the inactivity period elapses (permissionless; state-only).
    pub fn execute_intent(ctx: Context<ExecuteIntent>) -> Result<()> {
        instructions::execute_intent::handler(ctx)
    }

    /// Proof-of-life: bump last_activity while active (owner OR heartbeat authority).
    pub fn update_activity(ctx: Context<UpdateActivity>) -> Result<()> {
        instructions::update_activity::handler(ctx)
    }

    /// Distribute one asset from the Vault to beneficiaries by share_bps after the capsule fires.
    pub fn distribute_assets<'info>(
        ctx: Context<'_, '_, '_, 'info, DistributeAssets<'info>>,
    ) -> Result<()> {
        instructions::distribute_assets::handler(ctx)
    }

    /// Transfer one standard SPL NFT to its explicitly assigned recipient after the capsule fires.
    pub fn distribute_nft(ctx: Context<DistributeNft>, recipient: Pubkey) -> Result<()> {
        instructions::distribute_nft::handler(ctx, recipient)
    }

    /// Close a fully settled capsule and reclaim its account rent to the configured fee recipient.
    pub fn finalize_capsule(ctx: Context<FinalizeCapsule>) -> Result<()> {
        instructions::finalize_capsule::handler(ctx)
    }

    /// Owner escape hatch: recover one Vault asset while active, without touching the Switch.
    pub fn recover_vault(ctx: Context<RecoverVault>) -> Result<()> {
        instructions::recover_vault::handler(ctx)
    }

    /// Delegate the Switch (liveness only) to a regular MagicBlock ER. Token-free heartbeats.
    pub fn delegate_capsule(ctx: Context<DelegateCapsuleInput>) -> Result<()> {
        instructions::delegate_capsule::handler(ctx)
    }

    /// Delegate the private BeneficiarySet to the TEE behind a PER permission (owner-only member).
    pub fn delegate_beneficiaries(ctx: Context<DelegateBeneficiariesInput>) -> Result<()> {
        instructions::delegate_beneficiaries::handler(ctx)
    }

    /// Commit ER state and undelegate the Switch back to the base layer (crank-callable).
    pub fn crank_undelegate(ctx: Context<CrankUndelegateInput>) -> Result<()> {
        instructions::crank_undelegate::handler(ctx)
    }

    /// Commit + undelegate the BeneficiarySet (and its permission) back to base: the privacy reveal,
    /// gated on the owner OR an already-fired, base-committed Switch (crank-callable post-fire).
    pub fn crank_undelegate_beneficiaries(
        ctx: Context<CrankUndelegateBeneficiariesInput>,
    ) -> Result<()> {
        instructions::crank_undelegate_beneficiaries::handler(ctx)
    }

    /// Register a MagicBlock ScheduleTask crank that re-runs execute_intent at intervals.
    pub fn schedule_execute_intent(
        ctx: Context<ScheduleExecuteIntent>,
        args: ScheduleExecuteIntentArgs,
    ) -> Result<()> {
        instructions::schedule_execute_intent::handler(ctx, args)
    }
}

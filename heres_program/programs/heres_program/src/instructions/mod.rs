//! Instruction handlers. Each module holds one instruction's `Accounts` context and its
//! `handler` function. `lib.rs` delegates to `instructions::<module>::handler`.

pub mod arm_capsule;
pub mod cancel_capsule;
pub mod crank_undelegate;
pub mod crank_undelegate_beneficiaries;
pub mod create_capsule;
pub mod delegate_beneficiaries;
pub mod delegate_capsule;
pub mod deposit;
pub mod distribute_assets;
pub mod distribute_nft;
pub mod execute_intent;
pub mod finalize_capsule;
pub mod init_fee_config;
pub mod recover_vault;
pub mod schedule_execute_intent;
pub mod seal_inheritance;
pub mod update_activity;
pub mod update_fee_config;
pub mod update_intent;
pub mod update_nft_assignments;

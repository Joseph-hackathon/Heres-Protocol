//! Instruction handlers. Each module holds one instruction's `Accounts` context and its
//! `handler` function. `lib.rs` delegates to `instructions::<module>::handler`.

pub mod crank_undelegate;
pub mod create_capsule;
pub mod delegate_capsule;
pub mod distribute_assets;
pub mod execute_intent;
pub mod init_fee_config;
pub mod prepare_private_distribution;
pub mod recreate_capsule;
pub mod restart_timer;
pub mod sample_price;
pub mod schedule_execute_intent;
pub mod send_ccip_from_vault;
pub mod update_activity;
pub mod update_fee_config;
pub mod update_intent;

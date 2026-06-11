//! On-chain account state. Lean model: 3 accounts (Switch + Vault + FeeConfig).

pub mod capsule_vault;
pub mod fee_config;
pub mod intent_capsule;

pub use capsule_vault::*;
pub use fee_config::*;
pub use intent_capsule::*;

//! On-chain account state. Workstream A model: 4 accounts (Switch + BeneficiarySet + Vault + FeeConfig).

pub mod beneficiary_set;
pub mod capsule_vault;
pub mod fee_config;
pub mod intent_capsule;

pub use beneficiary_set::*;
pub use capsule_vault::*;
pub use fee_config::*;
pub use intent_capsule::*;

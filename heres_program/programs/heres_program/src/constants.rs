//! Program-wide constants.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::pubkey;

/// TEE validator for the Private Ephemeral Rollup (PER). Default when no validator account is passed.
/// Official MagicBlock devnet TEE validator (status.magicblock.app / magicblock-dev-skill resources).
pub const TEE_VALIDATOR: Pubkey = pubkey!("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");

/// MagicBlock Permission Program ID (PER access control).
pub const PERMISSION_PROGRAM_ID: Pubkey = pubkey!("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");

/// MagicBlock Delegation Program ID.
pub const DELEGATION_PROGRAM_ID: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/// Maximum one-time capsule creation fee in lamports (audit M2). 1 SOL ceiling so the fee
/// authority cannot make capsule creation arbitrarily expensive.
pub const MAX_CREATION_FEE_LAMPORTS: u64 = 1_000_000_000;

/// Max beneficiaries per capsule. Bounds the Switch account size and the per-asset distribution
/// loop (8 fit comfortably in one distribute tx, even with init-if-needed beneficiary ATAs).
pub const MAX_BENEFICIARIES: usize = 8;

/// Basis-points denominator. Beneficiary shares must sum to exactly this value (= 100%).
pub const BPS_DENOMINATOR: u16 = 10_000;

/// Grace window (seconds) after the switch fires before `distribute_assets` may run. During this
/// window the owner can still prove liveness via `update_activity` and revive the capsule.
/// 48h default. TEAM: confirm (lean-contract-redesign Open Q4 suggests 48-72h).
pub const GRACE_PERIOD: i64 = 48 * 60 * 60;

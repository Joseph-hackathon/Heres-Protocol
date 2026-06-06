//! Program-wide constant addresses.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::pubkey;

/// TEE validator for Private Ephemeral Rollup (PER). Used as default when no validator account is passed.
pub const TEE_VALIDATOR: Pubkey = pubkey!("FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA");

/// MagicBlock Permission Program ID for Access Control.
pub const PERMISSION_PROGRAM_ID: Pubkey = pubkey!("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");

/// MagicBlock Delegation Program ID.
pub const DELEGATION_PROGRAM_ID: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/// LINK token mint on devnet (used as CCIP fee token; the vault PDA is program-owned, not system-owned).
pub const LINK_TOKEN_MINT: Pubkey = pubkey!("LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L");

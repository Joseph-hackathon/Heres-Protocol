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

/// Maximum platform execution fee in basis points (audit M2). Caps the fee authority's skim at
/// 10% instead of the prior 100%, bounding what a compromised/malicious fee authority can take
/// from every distribution. A full timelock/multisig on the authority is still open (M2).
pub const MAX_EXECUTION_FEE_BPS: u16 = 1000;

/// Maximum one-time capsule creation fee in lamports (audit M2). 1 SOL ceiling so the fee
/// authority cannot make capsule creation arbitrarily expensive.
pub const MAX_CREATION_FEE_LAMPORTS: u64 = 1_000_000_000;

/// Chainlink CCIP Router program (devnet). Matches the off-chain config in `lib/ccip.ts`.
/// send_ccip_from_vault signs the vault PDA into this program, so it MUST be pinned: an
/// unconstrained router lets an attacker pass a malicious program and drain the vault (audit C2).
/// NOTE: this is the devnet router; swap to the mainnet router id before a mainnet deploy.
pub const CCIP_ROUTER_ID: Pubkey = pubkey!("Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C");

//! The private beneficiary list, split out of the Switch (Workstream A).
//!
//! Why a separate account: keeping liveness token-free requires the Switch on a *regular* ER, but
//! the beneficiary list must stay inside the TEE while the owner is alive (Tier-1 privacy). The two
//! cannot share an ER, so the one genuinely-private field lives here, delegated to the TEE, while the
//! (non-private) liveness state stays on the Switch in a regular ER. Heartbeats then never touch the
//! TEE, so the relayer never mints a TEE auth token on the hot path.
//!
//! Seeds = ["beneficiary_set", owner]. Set/edited ONLY via `update_intent` routed to the TEE after
//! delegation - never written to the base ledger in plaintext (redesign D8). Revealed on base only at
//! payout, when `crank_undelegate_beneficiaries` commits it back.

use anchor_lang::prelude::*;

use crate::constants::{MAX_BENEFICIARIES, MAX_NFT_ASSIGNMENTS};

/// One inheritance beneficiary and its share of every distributed asset, in basis points.
/// Shares across the set must sum to `BPS_DENOMINATOR` (10000 = 100%).
///
/// `reserved` pads each entry for a future cross-chain-heir field (e.g. a 20-byte EVM address + a
/// chain tag, when the CCIP heir module returns). Per-element width is the ONE dimension that
/// account-level padding cannot cover, so we reserve it up front to avoid a later resize of every
/// BeneficiarySet.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq)]
pub struct Beneficiary {
    pub pubkey: Pubkey,
    pub share_bps: u16,
    pub reserved: [u8; 14],
}

impl Beneficiary {
    pub const LEN: usize = 32 + 2 + 14; // 48
}

/// One standard SPL NFT and the wallet that receives it after the capsule fires. The mint must have
/// supply 1 and decimals 0 when `distribute_nft` executes. Assignments live inside the same TEE-
/// resident account as proportional beneficiaries, so the intended heir stays private while alive.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq)]
pub struct NftAssignment {
    pub mint: Pubkey,
    pub recipient: Pubkey,
}

impl NftAssignment {
    pub const LEN: usize = 32 + 32;
}

/// Per-owner private beneficiary list. Delegated to the TEE from creation; carries no funds and no
/// liveness - the Switch owns liveness, the base Vault owns assets.
#[account]
pub struct BeneficiarySet {
    pub owner: Pubkey,
    pub bump: u8,
    pub version: u8,
    pub beneficiaries: Vec<Beneficiary>, // cap MAX_BENEFICIARIES; PRIVATE while delegated to the TEE
    pub nft_assignments: Vec<NftAssignment>, // cap MAX_NFT_ASSIGNMENTS; PRIVATE while delegated
    pub reserved: [u8; 64],
}

impl BeneficiarySet {
    /// On-chain layout version. Bump when the struct changes so future code can branch on it.
    pub const CURRENT_VERSION: u8 = 2;

    pub const LEN: usize = 32 + // owner
        1 +                      // bump
        1 +                      // version
        4 + MAX_BENEFICIARIES * Beneficiary::LEN + // beneficiaries (Vec len prefix + capped elems)
        4 + MAX_NFT_ASSIGNMENTS * NftAssignment::LEN + // NFT assignments (Vec prefix + elems)
        64; // reserved (future per-set fields, no resize needed)
}

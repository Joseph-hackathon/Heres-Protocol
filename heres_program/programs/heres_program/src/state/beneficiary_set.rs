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
use solana_sha256_hasher::hash;

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
    pub const CURRENT_VERSION: u8 = 3;
    pub const SEALED_CONFIG_VERSION: u8 = 3;
    const SEALED_INDEX: usize = 0;
    const SALT_START: usize = 1;
    const SALT_END: usize = Self::SALT_START + 32;
    const CONFIG_DOMAIN: &'static [u8] = b"heres:inheritance-config:v1";

    pub const LEN: usize = 32 + // owner
        1 +                      // bump
        1 +                      // version
        4 + MAX_BENEFICIARIES * Beneficiary::LEN + // beneficiaries (Vec len prefix + capped elems)
        4 + MAX_NFT_ASSIGNMENTS * NftAssignment::LEN + // NFT assignments (Vec prefix + elems)
        64; // reserved (future per-set fields, no resize needed)

    pub fn requires_seal(&self) -> bool {
        self.version >= Self::SEALED_CONFIG_VERSION
    }

    pub fn is_sealed(&self) -> bool {
        self.reserved[Self::SEALED_INDEX] == 1
    }

    pub fn seal(&mut self, salt: [u8; 32]) {
        self.reserved[Self::SEALED_INDEX] = 1;
        self.reserved[Self::SALT_START..Self::SALT_END].copy_from_slice(&salt);
    }

    pub fn clear_seal(&mut self) {
        self.reserved[Self::SEALED_INDEX] = 0;
        self.reserved[Self::SALT_START..Self::SALT_END].fill(0);
    }

    pub fn config_salt(&self) -> [u8; 32] {
        let mut salt = [0u8; 32];
        salt.copy_from_slice(&self.reserved[Self::SALT_START..Self::SALT_END]);
        salt
    }

    /// Hash only fields that determine settlement. Beneficiary order is committed because the last
    /// entry receives rounding remainders. The salt stays private in the TEE until reveal.
    pub fn config_commitment(&self) -> [u8; 32] {
        let mut bytes = Vec::with_capacity(
            Self::CONFIG_DOMAIN.len()
                + 32
                + 4
                + self.beneficiaries.len() * (32 + 2)
                + 4
                + self.nft_assignments.len() * 64
                + 32,
        );
        bytes.extend_from_slice(Self::CONFIG_DOMAIN);
        bytes.extend_from_slice(self.owner.as_ref());
        bytes.extend_from_slice(&(self.beneficiaries.len() as u32).to_le_bytes());
        for beneficiary in &self.beneficiaries {
            bytes.extend_from_slice(beneficiary.pubkey.as_ref());
            bytes.extend_from_slice(&beneficiary.share_bps.to_le_bytes());
        }
        bytes.extend_from_slice(&(self.nft_assignments.len() as u32).to_le_bytes());
        for assignment in &self.nft_assignments {
            bytes.extend_from_slice(assignment.mint.as_ref());
            bytes.extend_from_slice(assignment.recipient.as_ref());
        }
        bytes.extend_from_slice(&self.config_salt());
        hash(&bytes).to_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn set() -> BeneficiarySet {
        BeneficiarySet {
            owner: Pubkey::new_unique(),
            bump: 1,
            version: BeneficiarySet::CURRENT_VERSION,
            beneficiaries: vec![
                Beneficiary {
                    pubkey: Pubkey::new_unique(),
                    share_bps: 6_000,
                    reserved: [0; 14],
                },
                Beneficiary {
                    pubkey: Pubkey::new_unique(),
                    share_bps: 4_000,
                    reserved: [0; 14],
                },
            ],
            nft_assignments: vec![],
            reserved: [0; 64],
        }
    }

    #[test]
    fn commitment_changes_when_settlement_configuration_changes() {
        let mut original = set();
        original.seal([7; 32]);
        let expected = original.config_commitment();

        original.beneficiaries[0].share_bps = 5_000;
        assert_ne!(original.config_commitment(), expected);
        original.beneficiaries[0].share_bps = 6_000;

        original.beneficiaries.swap(0, 1);
        assert_ne!(original.config_commitment(), expected);
        original.beneficiaries.swap(0, 1);

        original.seal([8; 32]);
        assert_ne!(original.config_commitment(), expected);
    }

    #[test]
    fn unused_beneficiary_padding_does_not_change_commitment() {
        let mut original = set();
        original.seal([9; 32]);
        let expected = original.config_commitment();
        original.beneficiaries[0].reserved = [42; 14];
        assert_eq!(original.config_commitment(), expected);
    }

    #[test]
    fn commitment_matches_the_client_test_vector() {
        let mut set = BeneficiarySet {
            owner: Pubkey::default(),
            bump: 1,
            version: BeneficiarySet::CURRENT_VERSION,
            beneficiaries: vec![Beneficiary {
                pubkey: Pubkey::from_str("SysvarC1ock11111111111111111111111111111111").unwrap(),
                share_bps: 10_000,
                reserved: [0; 14],
            }],
            nft_assignments: vec![NftAssignment {
                mint: Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap(),
                recipient: Pubkey::from_str("SysvarRent111111111111111111111111111111111").unwrap(),
            }],
            reserved: [0; 64],
        };
        set.seal([7; 32]);
        assert_eq!(
            set.config_commitment(),
            [
                0xca, 0x62, 0xc7, 0x44, 0x54, 0x4e, 0xe2, 0x81, 0x8f, 0xa8, 0x8e, 0x94, 0xca, 0xc6,
                0x87, 0x16, 0x29, 0x0a, 0x5c, 0x94, 0x91, 0xc3, 0xf0, 0x3b, 0x95, 0x70, 0x75, 0x97,
                0x4e, 0x8c, 0xe6, 0x24,
            ]
        );
    }
}

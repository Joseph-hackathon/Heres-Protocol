//! Vault PDA that custodies assets locked at capsule creation.
//! Seeds = ["capsule_vault", owner].
//!
//! Deliberately kept at one byte. New vaults use the high bit as the tracked-layout marker, the next
//! bit as the native-SOL leg, the next bit as the registered-token marker version, and the lower five
//! bits as the funded token-account count. Registered token ATAs also set their close authority to
//! the vault PDA, so a directly transferred spam mint cannot decrement another mint's manifest leg.

use anchor_lang::prelude::*;

/// Vault PDA holds SOL/SPL locked at capsule creation; anyone can trigger execute when conditions are met.
#[account]
pub struct CapsuleVault {
    pub version: u8, // legacy version, or TRACKED_FLAG | funded asset count
}

impl CapsuleVault {
    pub const LEN: usize = 1;
    const TRACKED_FLAG: u8 = 0x80;
    const NATIVE_ASSET_FLAG: u8 = 0x40;
    const REGISTERED_TOKEN_FLAG: u8 = 0x20;
    const TOKEN_COUNT_MASK: u8 = 0x1f;

    pub fn initialize_tracked(&mut self) {
        self.version = Self::TRACKED_FLAG | Self::REGISTERED_TOKEN_FLAG;
    }

    pub fn tracks_assets(&self) -> bool {
        self.version & Self::TRACKED_FLAG != 0
    }

    pub fn asset_count(&self) -> u8 {
        if self.tracks_assets() {
            (self.version & Self::TOKEN_COUNT_MASK)
                + u8::from(self.version & Self::NATIVE_ASSET_FLAG != 0)
        } else {
            0
        }
    }

    /// New manifests require every counted token ATA to carry an on-account registration marker.
    /// Older one-byte manifests remain readable but cannot safely infer mint identities.
    pub fn uses_registered_token_markers(&self) -> bool {
        self.tracks_assets() && self.version & Self::REGISTERED_TOKEN_FLAG != 0
    }

    pub fn register_native_asset(&mut self) {
        if self.tracks_assets() {
            self.version |= Self::NATIVE_ASSET_FLAG;
        }
    }

    pub fn unregister_native_asset(&mut self) {
        if self.tracks_assets() {
            self.version &= !Self::NATIVE_ASSET_FLAG;
        }
    }

    pub fn register_token_asset(&mut self) -> bool {
        if !self.uses_registered_token_markers() {
            return true;
        }
        let count = self.version & Self::TOKEN_COUNT_MASK;
        if count == Self::TOKEN_COUNT_MASK {
            return false;
        }
        self.version = (self.version & !Self::TOKEN_COUNT_MASK) | (count + 1);
        true
    }

    pub fn unregister_token_asset(&mut self) {
        if !self.uses_registered_token_markers() {
            return;
        }
        let count = self.version & Self::TOKEN_COUNT_MASK;
        if count > 0 {
            self.version = (self.version & !Self::TOKEN_COUNT_MASK) | (count - 1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_manifest_tracks_distinct_asset_legs() {
        let mut vault = CapsuleVault { version: 0 };
        vault.initialize_tracked();
        assert!(vault.tracks_assets());
        assert!(vault.uses_registered_token_markers());
        assert_eq!(vault.asset_count(), 0);
        vault.register_native_asset();
        assert!(vault.register_token_asset());
        assert_eq!(vault.asset_count(), 2);
        vault.unregister_token_asset();
        assert_eq!(vault.asset_count(), 1);
        vault.unregister_native_asset();
        assert_eq!(vault.asset_count(), 0);
    }

    #[test]
    fn legacy_vaults_remain_compatible() {
        let mut vault = CapsuleVault { version: 1 };
        assert!(!vault.tracks_assets());
        assert!(!vault.uses_registered_token_markers());
        vault.register_native_asset();
        assert!(vault.register_token_asset());
        vault.unregister_token_asset();
        vault.unregister_native_asset();
        assert_eq!(vault.version, 1);
    }

    #[test]
    fn pre_marker_manifests_do_not_mutate_unsafe_token_counts() {
        let mut vault = CapsuleVault { version: 0x82 };
        assert!(vault.tracks_assets());
        assert!(!vault.uses_registered_token_markers());
        assert!(vault.register_token_asset());
        vault.unregister_token_asset();
        assert_eq!(vault.version, 0x82);
    }
}

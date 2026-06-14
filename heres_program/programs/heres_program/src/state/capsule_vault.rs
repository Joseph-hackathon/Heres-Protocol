//! Vault PDA that custodies assets locked at capsule creation.
//! Seeds = ["capsule_vault", owner].
//!
//! Deliberately kept minimal: its data is never read (the SOL it holds + the ATAs it owns are the
//! whole story), and a larger account would lock more rent-exempt SOL that distribution leaves
//! stranded. So no reserved padding here - just a version byte for migration detection.

use anchor_lang::prelude::*;

/// Vault PDA holds SOL/SPL locked at capsule creation; anyone can trigger execute when conditions are met.
#[account]
pub struct CapsuleVault {
    pub version: u8, // layout version (was an unused `dummy` placeholder)
}

impl CapsuleVault {
    pub const CURRENT_VERSION: u8 = 1;
    pub const LEN: usize = 1;
}

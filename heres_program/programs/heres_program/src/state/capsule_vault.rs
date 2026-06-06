//! Vault PDA that custodies assets locked at capsule creation.
//! Seeds = ["capsule_vault", owner].

use anchor_lang::prelude::*;

/// Vault PDA holds SOL/SPL locked at capsule creation; anyone can trigger execute when conditions are met.
#[account]
pub struct CapsuleVault {
    pub dummy: u8, // placeholder for account discriminator + minimal data
}

impl CapsuleVault {
    pub const LEN: usize = 1;
}

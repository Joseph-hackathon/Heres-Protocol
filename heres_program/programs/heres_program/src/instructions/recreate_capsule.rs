//! Accounts context for recreating a capsule after execution.
//!
//! NOTE: the handler is not yet implemented. The off-chain client (`lib/solana.ts`)
//! already calls `recreateCapsule`, and the deployed IDL exposes it, so this context
//! is kept as the wiring target. Implementing the handler is tracked as a security/
//! lifecycle item (owner cancel/recreate path) before the next redeploy.

use anchor_lang::prelude::*;

use crate::state::{CapsuleVault, IntentCapsule};

#[derive(Accounts)]
pub struct RecreateCapsule<'info> {
    #[account(
        mut,
        seeds = [b"intent_capsule", owner.key().as_ref()],
        bump = capsule.bump
    )]
    pub capsule: Box<Account<'info, IntentCapsule>>,

    #[account(
        mut,
        seeds = [b"capsule_vault", owner.key().as_ref()],
        bump = capsule.vault_bump
    )]
    pub vault: Box<Account<'info, CapsuleVault>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

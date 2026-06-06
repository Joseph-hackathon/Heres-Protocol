//! Anchor events emitted by the program.

use anchor_lang::prelude::*;

#[event]
pub struct IntentExecuted {
    pub capsule: Pubkey,
    pub owner: Pubkey,
    pub executed_at: i64,
}

#[event]
pub struct CcipTransferRequested {
    pub capsule: Pubkey,
    pub beneficiary_index: u16,
    pub evm_address: String,
    pub destination_chain_selector: String,
    pub amount_lamports: u64,
}

#[event]
pub struct CcipTransferSent {
    pub capsule: Pubkey,
    pub beneficiary_index: u16,
    pub evm_address: String,
    pub destination_chain_selector: String,
    pub amount_lamports: u64,
}

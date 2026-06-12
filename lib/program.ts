/**
 * Solana program utilities
 */

import { PublicKey } from '@solana/web3.js'
import { getProgramId } from '@/config/solana'

/**
 * Derive capsule PDA (Program Derived Address)
 */
export function getCapsulePDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('intent_capsule'), owner.toBuffer()],
    getProgramId()
  )
}

/**
 * Derive fee config PDA (platform fee config, seeds = ["fee_config"])
 */
export function getFeeConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('fee_config')],
    getProgramId()
  )
}

/**
 * Derive capsule vault PDA (holds locked SOL, seeds = ["capsule_vault", owner])
 */
export function getCapsuleVaultPDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('capsule_vault'), owner.toBuffer()],
    getProgramId()
  )
}

/**
 * Derive Magicblock Buffer PDA (seeds = ["buffer", pda])
 */
export function getBufferPDA(pda: PublicKey, magicProgramId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('buffer'), pda.toBuffer()],
    magicProgramId
  )
}

/**
 * Derive Magicblock Delegation Record PDA (seeds = ["delegation", pda])
 */
export function getDelegationRecordPDA(pda: PublicKey, delegationProgramId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('delegation'), pda.toBuffer()],
    delegationProgramId
  )
}

/**
 * Derive Magicblock Delegation Metadata PDA (seeds = ["delegation-metadata", pda])
 */
export function getDelegationMetadataPDA(pda: PublicKey, delegationProgramId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('delegation-metadata'), pda.toBuffer()],
    delegationProgramId
  )
}

/**
 * Derive Magicblock Permission PDA (seeds = ["permission:", pda]).
 * Used for Private Ephemeral Rollups (PER) access control.
 * NOTE: the SDK seed is "permission:" WITH the trailing colon (Permission::find_pda);
 * the lean program derives it that way, so the colon is load-bearing.
 */
export function getPermissionPDA(pda: PublicKey, permissionProgramId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('permission:'), pda.toBuffer()],
    permissionProgramId
  )
}

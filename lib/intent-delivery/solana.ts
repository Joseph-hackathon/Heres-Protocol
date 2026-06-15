import 'server-only'

import { PublicKey } from '@solana/web3.js'
import { getCapsulePDA } from '@/lib/program'
import { getSolanaConnection, getTeeConnection } from '@/config/solana'
import { MAGICBLOCK_ER } from '@/constants'
import { tryDecodeIntentCapsule } from '@/lib/lean-capsule'
import type { OnChainBeneficiary } from '@/types'

export interface DecodedCapsuleState {
  capsuleAddress: string
  owner: PublicKey
  inactivityPeriod: number
  lastActivity: number
  isActive: boolean
  executedAt: number | null
  accountOwner: PublicKey
  vaultBump?: number
  beneficiaries: OnChainBeneficiary[]
}

function decodeCapsuleAccountData(capsuleAddress: PublicKey, accountOwner: PublicKey, data: Buffer): DecodedCapsuleState | null {
  const capsule = tryDecodeIntentCapsule(data)
  if (!capsule) return null

  return {
    capsuleAddress: capsuleAddress.toBase58(),
    owner: capsule.owner,
    inactivityPeriod: capsule.inactivityPeriod,
    lastActivity: capsule.lastActivity,
    isActive: capsule.isActive,
    executedAt: capsule.executedAt,
    accountOwner,
    vaultBump: capsule.vaultBump,
    beneficiaries: capsule.beneficiaries,
  }
}

export async function fetchCapsuleStateByAddress(capsuleAddress: PublicKey): Promise<DecodedCapsuleState | null> {
  const connection = getSolanaConnection()
  const accountInfo = await connection.getAccountInfo(capsuleAddress)
  if (!accountInfo?.data) return null

  let data = accountInfo.data
  const accountOwner = accountInfo.owner
  const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)

  if (accountOwner.equals(delegationProgramId) && accountInfo.data.length >= 32) {
    const validator = new PublicKey(accountInfo.data.slice(0, 32))
    if (validator.toBase58() === MAGICBLOCK_ER.VALIDATOR_TEE) {
      try {
        const teeAccount = await getTeeConnection().getAccountInfo(capsuleAddress)
        if (teeAccount?.data) data = teeAccount.data
      } catch {
        // Keep base-layer data if TEE fetch fails.
      }
    }
  }

  return decodeCapsuleAccountData(capsuleAddress, accountOwner, data)
}

export async function fetchCapsuleStateByOwner(owner: PublicKey): Promise<DecodedCapsuleState | null> {
  const [capsuleAddress] = getCapsulePDA(owner)
  return fetchCapsuleStateByAddress(capsuleAddress)
}

/**
 * Batch-fetch capsule states for many owners with getMultipleAccountsInfo
 * (M2: one RPC round-trip per 100 owners instead of one per owner). Base-layer
 * accounts are decoded inline; a capsule delegated to the validator TEE falls
 * back to the per-account TEE read so its live ER state is still read correctly.
 *
 * Returns a Map keyed by owner base58 -> state (null if the capsule account is
 * missing or undecodable). Owners that fail to parse as a pubkey are skipped.
 */
export async function fetchCapsuleStatesBatched(
  owners: string[]
): Promise<Map<string, DecodedCapsuleState | null>> {
  const out = new Map<string, DecodedCapsuleState | null>()
  const connection = getSolanaConnection()
  const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)

  // Resolve each owner to its capsule PDA, dropping malformed entries.
  const targets: { ownerStr: string; capsulePDA: PublicKey }[] = []
  for (const ownerStr of owners) {
    try {
      const [capsulePDA] = getCapsulePDA(new PublicKey(ownerStr))
      targets.push({ ownerStr, capsulePDA })
    } catch {
      // skip unparseable owner string
    }
  }

  const CHUNK = 100
  for (let i = 0; i < targets.length; i += CHUNK) {
    const slice = targets.slice(i, i + CHUNK)
    const infos = await connection.getMultipleAccountsInfo(
      slice.map((t) => t.capsulePDA),
      'confirmed'
    )

    for (let j = 0; j < slice.length; j++) {
      const { ownerStr, capsulePDA } = slice[j]
      const info = infos[j]
      if (!info?.data) {
        out.set(ownerStr, null)
        continue
      }

      const accountOwner = info.owner
      // Delegated to the TEE validator: the base-layer buffer is a stub, so read
      // the live state from the TEE connection (matches fetchCapsuleStateByAddress).
      if (accountOwner.equals(delegationProgramId) && info.data.length >= 32) {
        const validator = new PublicKey(info.data.slice(0, 32))
        if (validator.toBase58() === MAGICBLOCK_ER.VALIDATOR_TEE) {
          out.set(ownerStr, await fetchCapsuleStateByAddress(capsulePDA))
          continue
        }
      }

      out.set(ownerStr, decodeCapsuleAccountData(capsulePDA, accountOwner, info.data))
    }
  }

  return out
}

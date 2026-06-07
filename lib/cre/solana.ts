import 'server-only'

import { PublicKey } from '@solana/web3.js'
import { getCapsulePDA } from '@/lib/program'
import { getSolanaConnection, getTeeConnection } from '@/config/solana'
import { MAGICBLOCK_ER } from '@/constants'

export interface DecodedCapsuleState {
  capsuleAddress: string
  owner: PublicKey
  inactivityPeriod: number
  lastActivity: number
  intentData: Uint8Array
  isActive: boolean
  executedAt: number | null
  accountOwner: PublicKey
  mint: PublicKey
  retryCount: number
  ccipSentBitmap: number
  privateDistributed: boolean
  lockedAmount: number
  distributed: boolean
  vaultBump: number
}

function readI64(bytes: Uint8Array, start: number): bigint {
  let result = 0n
  for (let i = 0; i < 8; i++) {
    result |= BigInt(bytes[start + i]) << BigInt(i * 8)
  }
  if (result & (1n << 63n)) {
    result -= 1n << 64n
  }
  return result
}

function readU64(bytes: Uint8Array, start: number): bigint {
  let result = 0n
  for (let i = 0; i < 8; i++) {
    result |= BigInt(bytes[start + i]) << BigInt(i * 8)
  }
  return result
}

function readU32(bytes: Uint8Array, start: number): number {
  return bytes[start] | (bytes[start + 1] << 8) | (bytes[start + 2] << 16) | (bytes[start + 3] << 24)
}

function decodeCapsuleAccountData(capsuleAddress: PublicKey, accountOwner: PublicKey, data: Buffer): DecodedCapsuleState | null {
  if (!data || data.length < 64) return null
  let offset = 8 // Anchor discriminator
  const owner = new PublicKey(data.slice(offset, offset + 32))
  offset += 32

  const inactivityPeriod = Number(readI64(data, offset))
  offset += 8
  const lastActivity = Number(readI64(data, offset))
  offset += 8

  const intentDataLength = readU32(data, offset)
  offset += 4
  const intentData = new Uint8Array(data.slice(offset, offset + intentDataLength))
  offset += intentDataLength

  const isActive = data[offset] === 1
  offset += 1

  const hasExecutedAt = data[offset] === 1
  offset += 1
  const executedAt = hasExecutedAt ? Number(readI64(data, offset)) : null
  if (hasExecutedAt) {
    offset += 8
  }

  // Read additional fields (added in program v0.2.0)
  // bump: u8
  const bump = data[offset]
  offset += 1
  // vault_bump: u8
  const vaultBump = data[offset]
  offset += 1
  // mint: Pubkey (32)
  const mint = new PublicKey(data.slice(offset, offset + 32))
  offset += 32
  // retry_count: u64
  const retryCount = Number(readU64(data, offset))
  offset += 8
  // ccip_sent_bitmap: u16
  const ccipSentBitmap = data[offset] | (data[offset + 1] << 8)
  offset += 2
  // private_distributed: bool (u8)
  const privateDistributed = data[offset] === 1
  offset += 1
  // locked_amount: u64 (audit H4) then distributed: bool (audit H1).
  // Guard offsets: delegated stubs / legacy capsules may be shorter than the full layout.
  let lockedAmount = 0
  let distributed = false
  if (offset + 8 <= data.length) {
    lockedAmount = Number(readU64(data, offset))
    offset += 8
    if (offset < data.length) {
      distributed = data[offset] === 1
      offset += 1
    }
  }

  return {
    capsuleAddress: capsuleAddress.toBase58(),
    owner,
    inactivityPeriod,
    lastActivity,
    intentData,
    isActive,
    executedAt,
    accountOwner,
    mint,
    retryCount,
    ccipSentBitmap,
    privateDistributed,
    lockedAmount,
    distributed,
    vaultBump,
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


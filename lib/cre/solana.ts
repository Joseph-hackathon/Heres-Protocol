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

  return {
    capsuleAddress: capsuleAddress.toBase58(),
    owner,
    inactivityPeriod,
    lastActivity,
    intentData,
    isActive,
    executedAt,
    accountOwner,
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


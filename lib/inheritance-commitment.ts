import { PublicKey } from '@solana/web3.js'
import type { OnChainBeneficiary, OnChainNftAssignment } from '@/types'

const CONFIG_DOMAIN = new TextEncoder().encode('heres:inheritance-config:v1')
const COMMITMENT_BYTES = 32

function u16Le(value: number): Uint8Array {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, true)
  return bytes
}

function u32Le(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

export function createInheritanceSalt(): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random generation is unavailable in this environment')
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(COMMITMENT_BYTES))
}

export function encodeInheritanceCommitment(
  owner: PublicKey,
  beneficiaries: OnChainBeneficiary[],
  nftAssignments: OnChainNftAssignment[],
  salt: Uint8Array
): Uint8Array {
  if (salt.length !== COMMITMENT_BYTES) throw new Error('Inheritance commitment salt must be 32 bytes')

  const parts: Uint8Array[] = [
    CONFIG_DOMAIN,
    owner.toBytes(),
    u32Le(beneficiaries.length),
  ]
  for (const beneficiary of beneficiaries) {
    parts.push(beneficiary.pubkey.toBytes(), u16Le(beneficiary.shareBps))
  }
  parts.push(u32Le(nftAssignments.length))
  for (const assignment of nftAssignments) {
    parts.push(assignment.mint.toBytes(), assignment.recipient.toBytes())
  }
  parts.push(salt)
  return concatBytes(parts)
}

export async function createInheritanceCommitment(
  owner: PublicKey,
  beneficiaries: OnChainBeneficiary[],
  nftAssignments: OnChainNftAssignment[],
  salt: Uint8Array
): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is unavailable in this environment')
  }
  const encoded = encodeInheritanceCommitment(owner, beneficiaries, nftAssignments, salt)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded as BufferSource)
  return new Uint8Array(digest)
}

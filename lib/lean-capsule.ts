/**
 * Single source of truth for decoding the LEAN on-chain accounts (the Switch + the BeneficiarySet).
 *
 * Workstream A split the private beneficiary list out of the Switch into its own account, so there
 * are now two layouts to decode:
 *   - IntentCapsule (the "Switch"): owner, inactivity_period, last_activity, is_active, executed_at,
 *     bump, vault_bump, beneficiaries_bump, heartbeat_authority, version, reserved. It NO LONGER
 *     carries beneficiaries - liveness only. It lives on a regular ER when delegated.
 *   - BeneficiarySet: owner, bump, version, beneficiaries(Vec<{pubkey, share_bps, reserved}>),
 *     reserved. The single enclave-resident account (TEE), revealed to base before distribution.
 *
 * We decode with the Anchor BorshAccountsCoder (isomorphic - browser + server) against the same
 * fresh-build IDL the program was deployed from, so the layout can never silently drift from a manual
 * offset table. BorshAccountsCoder.decode returns raw snake_case fields (is_active, share_bps); we
 * normalize to the camelCase shapes the app uses.
 */
import { BorshAccountsCoder } from '@coral-xyz/anchor'
import idl from '../idl/heres_program.json'
import type { IntentCapsule, OnChainBeneficiary } from '@/types'

const accountsCoder = new BorshAccountsCoder(idl as any)

/**
 * Decode raw account data for a lean IntentCapsule (the Switch). Liveness only - the private
 * beneficiary list now lives in the BeneficiarySet (see decodeBeneficiarySet), so `beneficiaries` is
 * returned empty here; the read path (lib/solana getCapsule) populates it from a separate set read.
 * Throws if the bytes are not a valid capsule.
 */
export function decodeIntentCapsule(data: Buffer | Uint8Array): IntentCapsule {
  const c = accountsCoder.decode('IntentCapsule', Buffer.from(data)) as any
  return {
    owner: c.owner,
    inactivityPeriod: c.inactivity_period.toNumber(),
    lastActivity: c.last_activity.toNumber(),
    isActive: c.is_active,
    executedAt: c.executed_at == null ? null : c.executed_at.toNumber(),
    bump: c.bump,
    vaultBump: c.vault_bump,
    beneficiariesBump: c.beneficiaries_bump,
    heartbeatAuthority: c.heartbeat_authority,
    beneficiaries: [],
  }
}

/** Best-effort decode: returns null instead of throwing (for list scans over mixed accounts). */
export function tryDecodeIntentCapsule(data: Buffer | Uint8Array): IntentCapsule | null {
  try {
    return decodeIntentCapsule(data)
  } catch {
    return null
  }
}

/**
 * Decode raw account data for a BeneficiarySet. Returns its owner and the normalized beneficiary list
 * (pubkey + shareBps). The on-chain `reserved` pad per entry is dropped - the app never needs it for
 * reads. Throws if the bytes are not a valid set (e.g. a TEE-filtered / still-delegated stub).
 */
export function decodeBeneficiarySet(data: Buffer | Uint8Array): {
  owner: OnChainBeneficiary['pubkey']
  beneficiaries: OnChainBeneficiary[]
} {
  const s = accountsCoder.decode('BeneficiarySet', Buffer.from(data)) as any
  const beneficiaries: OnChainBeneficiary[] = (s.beneficiaries ?? []).map((b: any) => ({
    pubkey: b.pubkey,
    shareBps: typeof b.share_bps === 'number' ? b.share_bps : Number(b.share_bps),
  }))
  return { owner: s.owner, beneficiaries }
}

/** Best-effort BeneficiarySet decode: returns null instead of throwing (delegated/filtered reads). */
export function tryDecodeBeneficiarySet(data: Buffer | Uint8Array): OnChainBeneficiary[] | null {
  try {
    return decodeBeneficiarySet(data).beneficiaries
  } catch {
    return null
  }
}

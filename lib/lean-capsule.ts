/**
 * Single source of truth for decoding the LEAN IntentCapsule (Switch) account.
 *
 * Replaces the hand-rolled byte-offset decoders that read the OLD fat layout (intent_data Vec<u8>,
 * single mint). The lean layout is: owner, inactivity_period, last_activity, is_active, executed_at,
 * bump, vault_bump, heartbeat_authority, beneficiaries(Vec<{pubkey, share_bps}>). We decode with the
 * Anchor BorshAccountsCoder (isomorphic - works in the browser and on the server) against the same
 * fresh-build IDL the program was deployed from, so the layout can never silently drift from a manual
 * offset table again.
 *
 * BorshAccountsCoder.decode returns raw snake_case fields (is_active, executed_at, share_bps) and is
 * reliable for this IDL where program.coder.accounts is not (anchor 0.32). We normalize to the
 * camelCase IntentCapsule shape the app uses.
 */
import { BorshAccountsCoder } from '@coral-xyz/anchor'
import idl from '../idl/heres_program.json'
import type { IntentCapsule, OnChainBeneficiary } from '@/types'

const accountsCoder = new BorshAccountsCoder(idl as any)

/** Decode raw account data for a lean IntentCapsule. Throws if the bytes are not a valid capsule. */
export function decodeIntentCapsule(data: Buffer | Uint8Array): IntentCapsule {
  const c = accountsCoder.decode('IntentCapsule', Buffer.from(data)) as any
  const beneficiaries: OnChainBeneficiary[] = (c.beneficiaries ?? []).map((b: any) => ({
    pubkey: b.pubkey,
    shareBps: typeof b.share_bps === 'number' ? b.share_bps : Number(b.share_bps),
  }))
  return {
    owner: c.owner,
    inactivityPeriod: c.inactivity_period.toNumber(),
    lastActivity: c.last_activity.toNumber(),
    isActive: c.is_active,
    executedAt: c.executed_at == null ? null : c.executed_at.toNumber(),
    bump: c.bump,
    vaultBump: c.vault_bump,
    heartbeatAuthority: c.heartbeat_authority,
    beneficiaries,
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

import 'server-only'

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import { Program, AnchorProvider, type Wallet } from '@coral-xyz/anchor'
import idl from '../idl/heres_program.json'
import { getSolanaConnection } from '@/config/solana'
import { getCapsulePDA } from './program'
import { getRegisteredOwners } from './capsule-registry'
import { loadSyncCheckpoint, saveSyncCheckpoint } from './dashboard-store'
import { getWalletActivity } from './helius'
import { MAGICBLOCK_ER } from '@/constants'
import { confirmTransactionOrThrow } from '@/lib/transaction-confirmation'

/**
 * Off-chain liveness service: the missing half of the dead-man's-switch.
 *
 * The on-chain switch fires on the ABSENCE of activity, but Helius can only tell us when activity
 * HAPPENS - you cannot get a webhook for "nothing happened". So this service polls each registered
 * owner's wallet via Helius and, on genuinely new on-chain activity, has the relayer
 * (heartbeat_authority) bump last_activity. That is the proof-of-life input: using your wallet keeps
 * you alive. Without it, the switch fires on a living owner who simply didn't manually heartbeat.
 *
 * Workstream A: the Switch (liveness) now lives on a REGULAR ER, never the TEE - only the separate
 * BeneficiarySet is enclave-resident. So the heartbeat hot path is TOKEN-FREE: update_activity is a
 * gasless write to the regular ER (or base, pre-delegation) with no getAuthToken round-trip. "Is this
 * activity new?" is still answered off-chain via a per-owner last-signature marker (Helius is the
 * activity source; we avoid an ER read per tick), but the TEE token machinery is gone from here.
 */

const DELEGATION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)

// Bound the per-run cost: a single tick processes at most this many owners. Larger registries spread
// across ticks (the dedup marker makes re-scanning cheap).
const MAX_OWNERS_PER_RUN = 200

// ---- Anchor program + tx helpers (server keypair, mirrors lib/crank.ts) ---------------------------

function makeWallet(kp: Keypair): Wallet {
  return {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async (tx: any) => {
      tx.sign(kp)
      return tx
    },
    signAllTransactions: async (txs: any[]) => {
      txs.forEach((tx) => tx.sign(kp))
      return txs
    },
  } as unknown as Wallet
}

function programFor(connection: Connection, kp: Keypair): Program {
  return new Program(idl as any, new AnchorProvider(connection, makeWallet(kp), { commitment: 'confirmed' }))
}

/** Send + confirm a base-layer tx (skipPreflight - the lean binary simulates fine but stays cheap). */
async function sendBase(connection: Connection, kp: Keypair, ixs: TransactionInstruction[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight })
  ixs.forEach((ix) => tx.add(ix))
  tx.sign(kp)
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true })
  await confirmTransactionOrThrow(connection, { signature: sig, blockhash, lastValidBlockHeight })
  return sig
}

/** Send to an ER (regular or TEE) and confirm by HTTP status polling (no WS, token-safe). */
async function sendEr(connection: Connection, kp: Keypair, ixs: TransactionInstruction[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight })
  ixs.forEach((ix) => tx.add(ix))
  tx.sign(kp)
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true })
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const s = (await connection.getSignatureStatuses([sig]))?.value?.[0]
    if (!s) continue
    if (s.err) throw new Error('ER tx err: ' + JSON.stringify(s.err))
    if (['processed', 'confirmed', 'finalized'].includes(s.confirmationStatus ?? '')) return sig
  }
  throw new Error('ER confirm timeout for ' + sig.slice(0, 16))
}

// ---- Delegation routing: where does the Switch live right now? -------------------------------------

type Target = 'base' | 'regular-er' | 'missing'

/**
 * Read ONLY the base account to decide where update_activity must go. The Switch is either on base
 * (program-owned, pre-delegation) or delegated to the regular ER (owned by the delegation program).
 * It is NEVER on the TEE under Workstream A, so no validator-stub inspection or token is needed.
 */
async function delegationTarget(owner: PublicKey): Promise<Target> {
  const [capsule] = getCapsulePDA(owner)
  const info = await getSolanaConnection().getAccountInfo(capsule, 'confirmed')
  if (!info) return 'missing'
  return info.owner.equals(DELEGATION_PROGRAM_ID) ? 'regular-er' : 'base'
}

/** Build update_activity signed by the relayer (heartbeat_authority). No permission accounts. */
function updateActivityIx(prog: Program, owner: PublicKey, relayer: PublicKey): Promise<TransactionInstruction> {
  const [capsule] = getCapsulePDA(owner)
  return prog.methods.updateActivity().accountsPartial({ capsule, authority: relayer }).instruction()
}

/** Send the liveness bump to wherever the Switch currently lives (base or regular ER). Token-free. */
async function bumpLiveness(owner: PublicKey, relayer: Keypair, target: Target): Promise<string> {
  if (target === 'base') {
    const conn = getSolanaConnection()
    return sendBase(conn, relayer, [await updateActivityIx(programFor(conn, relayer), owner, relayer.publicKey)])
  }
  // regular-er: gasless, token-free write to the ER where the Switch is delegated.
  const conn = new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
  return sendEr(conn, relayer, [await updateActivityIx(programFor(conn, relayer), owner, relayer.publicKey)])
}

/**
 * The relayer's update_activity is rejected (not a service error) when the capsule is already fired
 * (CapsuleInactive) or the relayer is not its heartbeat_authority / TEE member (Unauthorized). These
 * are expected for terminal or legacy (owner-as-heartbeat) capsules - skip, do not fail the run.
 */
function isExpectedReject(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e)
  // ErrorCode bases (anchor 6000+): Unauthorized, CapsuleInactive. Plus PER non-member write rejects.
  return /Unauthorized|CapsuleInactive|6000|6001|6002|not a member|permission/i.test(m)
}

// ---- Per-owner sync + the run loop ----------------------------------------------------------------

const markerKey = (owner: string) => `heartbeat:lastsig:${owner}`
type Marker = { signature: string; activityTs: number; bumpedAt: number; txSig?: string }

export type OwnerSyncResult =
  | { owner: string; status: 'bumped'; signature: string; txSig: string; target: Target }
  | { owner: string; status: 'baseline' | 'unchanged' | 'no-activity' | 'missing' | 'skipped' | 'error'; detail?: string }

/**
 * Sync one owner: read its latest on-chain activity from Helius, and if it is newer than the last
 * signature we bumped on, push a liveness bump to wherever the Switch is delegated. The first time we
 * ever see an owner we only record a baseline (we cannot tell if its latest tx is new or months old).
 */
async function syncOwner(ownerStr: string, relayer: Keypair): Promise<OwnerSyncResult> {
  let owner: PublicKey
  try {
    owner = new PublicKey(ownerStr)
  } catch {
    return { owner: ownerStr, status: 'error', detail: 'unparseable owner' }
  }

  const activity = await getWalletActivity(ownerStr)
  if (!activity || !activity.lastSignature) return { owner: ownerStr, status: 'no-activity' }

  const marker = await loadSyncCheckpoint<Marker>(markerKey(ownerStr))
  if (!marker) {
    // Establish a baseline without bumping - we don't know if this latest tx is fresh or stale.
    await saveSyncCheckpoint(markerKey(ownerStr), {
      signature: activity.lastSignature,
      activityTs: activity.lastActivityTimestamp,
      bumpedAt: 0,
    } satisfies Marker)
    return { owner: ownerStr, status: 'baseline' }
  }
  if (marker.signature === activity.lastSignature) return { owner: ownerStr, status: 'unchanged' }

  // Genuinely new activity -> bump liveness.
  const target = await delegationTarget(owner)
  if (target === 'missing') return { owner: ownerStr, status: 'missing' }

  try {
    const txSig = await bumpLiveness(owner, relayer, target)
    await saveSyncCheckpoint(markerKey(ownerStr), {
      signature: activity.lastSignature,
      activityTs: activity.lastActivityTimestamp,
      bumpedAt: Date.now(),
      txSig,
    } satisfies Marker)
    return { owner: ownerStr, status: 'bumped', signature: activity.lastSignature, txSig, target }
  } catch (e) {
    if (isExpectedReject(e)) {
      // Advance the marker so we don't retry the same rejected activity every tick.
      await saveSyncCheckpoint(markerKey(ownerStr), {
        signature: activity.lastSignature,
        activityTs: activity.lastActivityTimestamp,
        bumpedAt: marker.bumpedAt,
      } satisfies Marker)
      return { owner: ownerStr, status: 'skipped', detail: e instanceof Error ? e.message.slice(0, 120) : String(e) }
    }
    return { owner: ownerStr, status: 'error', detail: e instanceof Error ? e.message.slice(0, 160) : String(e) }
  }
}

export type LivenessSyncResult = {
  ok: boolean
  scanned: number
  bumped: number
  baseline: number
  unchanged: number
  noActivity: number
  skipped: number
  missing: number
  errors: string[]
}

/** Run one liveness tick over all registered owners (bounded), bumping those with new wallet activity. */
export async function runLivenessSync(relayer: Keypair): Promise<LivenessSyncResult> {
  const allOwners = await getRegisteredOwners()
  const owners = allOwners.slice(0, MAX_OWNERS_PER_RUN)

  const result: LivenessSyncResult = {
    ok: true,
    scanned: owners.length,
    bumped: 0,
    baseline: 0,
    unchanged: 0,
    noActivity: 0,
    skipped: 0,
    missing: 0,
    errors: [],
  }
  if (allOwners.length > owners.length) {
    result.errors.push(`registry has ${allOwners.length} owners; capped this tick to ${owners.length}`)
  }

  // Small concurrency: Helius + a tx per owner, kept gentle to respect the free-tier RPC.
  const CHUNK = 4
  for (let i = 0; i < owners.length; i += CHUNK) {
    const batch = await Promise.all(owners.slice(i, i + CHUNK).map((o) => syncOwner(o, relayer)))
    for (const r of batch) {
      switch (r.status) {
        case 'bumped':
          result.bumped += 1
          break
        case 'baseline':
          result.baseline += 1
          break
        case 'unchanged':
          result.unchanged += 1
          break
        case 'no-activity':
          result.noActivity += 1
          break
        case 'missing':
          result.missing += 1
          break
        case 'skipped':
          result.skipped += 1
          break
        case 'error':
          result.ok = false
          result.errors.push(`${r.owner}: ${r.detail ?? 'error'}`)
          break
      }
    }
  }

  return result
}

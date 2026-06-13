import 'server-only'

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import { Program, AnchorProvider, type Wallet } from '@coral-xyz/anchor'
import nacl from 'tweetnacl'
import { getAuthToken } from '@magicblock-labs/ephemeral-rollups-sdk'
import idl from '../idl/heres_program.json'
import { getSolanaConnection } from '@/config/solana'
import { getCapsulePDA } from './program'
import { getRegisteredOwners } from './capsule-registry'
import { loadSyncCheckpoint, saveSyncCheckpoint } from './dashboard-store'
import { getWalletActivity } from './helius'
import { MAGICBLOCK_ER, PER_TEE } from '@/constants'

/**
 * Off-chain liveness service: the missing half of the dead-man's-switch.
 *
 * The on-chain switch fires on the ABSENCE of activity, but Helius can only tell us when activity
 * HAPPENS - you cannot get a webhook for "nothing happened". So this service polls each registered
 * owner's wallet via Helius and, on genuinely new on-chain activity, has the relayer
 * (heartbeat_authority) bump last_activity. That is the proof-of-life input: using your wallet keeps
 * you alive. Without it, the switch fires on a living owner who simply didn't manually heartbeat.
 *
 * The relayer cannot READ last_activity on a TEE-delegated Switch (the Query Filtering Service hides
 * it from a 0-read-flag member), so "is this activity new?" is answered off-chain: we remember the
 * last signature we bumped on per owner and only bump when Helius reports a different latest signature.
 * The relayer CAN write (update_activity) without read access - that is exactly the privacy model.
 */

const DELEGATION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
const VALIDATOR_TEE = new PublicKey(MAGICBLOCK_ER.VALIDATOR_TEE)
const TEE_RPC = PER_TEE.RPC_URL.replace(/\/+$/, '')
const TEE_AUTH_URL = PER_TEE.AUTH_URL.replace(/\/+$/, '')

// Bound the per-run cost: a single tick processes at most this many owners. Larger registries spread
// across ticks (the dedup marker makes re-scanning cheap).
const MAX_OWNERS_PER_RUN = 200

// ---- Server-side TEE auth token (relayer key), cached + auto-refreshed ----------------------------

type CachedToken = { token: string; mintedAt: number }
const teeTokenCache = new Map<string, CachedToken>()
// TEE tokens are short-lived; re-mint every few minutes. Minting is a signature, not an RPC round to a
// gated endpoint, so it is cheap. A read/write that 401s forces an immediate re-mint regardless.
const TEE_TOKEN_TTL_MS = 5 * 60 * 1000

/** Sign an arbitrary message with a server-held keypair (the SDK getAuthToken signMessage shape). */
function keypairSignMessage(kp: Keypair) {
  return (msg: Uint8Array) => Promise.resolve(nacl.sign.detached(msg, kp.secretKey))
}

/** Mint (or reuse) a TEE auth token for a server keypair. forceRefresh re-mints past a stale token. */
async function getTeeToken(kp: Keypair, forceRefresh = false): Promise<string> {
  const key = kp.publicKey.toBase58()
  const cached = teeTokenCache.get(key)
  if (!forceRefresh && cached && Date.now() - cached.mintedAt < TEE_TOKEN_TTL_MS) return cached.token
  const { token } = await getAuthToken(TEE_AUTH_URL, kp.publicKey, keypairSignMessage(kp))
  teeTokenCache.set(key, { token, mintedAt: Date.now() })
  return token
}

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
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
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

type Target = 'base' | 'regular-er' | 'tee' | 'missing'

/**
 * Read ONLY the base account to decide where update_activity must go. A delegated Switch is owned by
 * the delegation program; its data stub's first 32 bytes are the validator it was delegated to, so we
 * tell a TEE-delegated Switch from a regular-ER one without any token or ER read.
 */
async function delegationTarget(owner: PublicKey): Promise<Target> {
  const [capsule] = getCapsulePDA(owner)
  const info = await getSolanaConnection().getAccountInfo(capsule, 'confirmed')
  if (!info) return 'missing'
  if (!info.owner.equals(DELEGATION_PROGRAM_ID)) return 'base'
  const stub = Buffer.from(info.data)
  if (stub.length >= 32 && new PublicKey(stub.subarray(0, 32)).equals(VALIDATOR_TEE)) return 'tee'
  return 'regular-er'
}

/** Build update_activity signed by the relayer (heartbeat_authority). No permission accounts. */
function updateActivityIx(prog: Program, owner: PublicKey, relayer: PublicKey): Promise<TransactionInstruction> {
  const [capsule] = getCapsulePDA(owner)
  return prog.methods.updateActivity().accountsPartial({ capsule, authority: relayer }).instruction()
}

/** Send the liveness bump to wherever the Switch currently lives. Returns the tx signature. */
async function bumpLiveness(owner: PublicKey, relayer: Keypair, target: Target): Promise<string> {
  if (target === 'base') {
    const conn = getSolanaConnection()
    return sendBase(conn, relayer, [await updateActivityIx(programFor(conn, relayer), owner, relayer.publicKey)])
  }
  if (target === 'regular-er') {
    const conn = new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
    return sendEr(conn, relayer, [await updateActivityIx(programFor(conn, relayer), owner, relayer.publicKey)])
  }
  // TEE: needs a relayer auth token. Retry once with a fresh token on an auth (401) failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getTeeToken(relayer, attempt > 0)
    const conn = new Connection(`${TEE_RPC}?token=${token}`, { commitment: 'confirmed' })
    try {
      return await sendEr(conn, relayer, [await updateActivityIx(programFor(conn, relayer), owner, relayer.publicKey)])
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (attempt === 0 && /401|InvalidToken|Missing token|Unauthorized/i.test(m)) continue
      throw e
    }
  }
  throw new Error('unreachable')
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

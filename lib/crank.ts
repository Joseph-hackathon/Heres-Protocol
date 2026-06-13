import 'server-only'

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import { Program, AnchorProvider, BorshAccountsCoder, type Wallet } from '@coral-xyz/anchor'
import nacl from 'tweetnacl'
import { getAuthToken } from '@magicblock-labs/ephemeral-rollups-sdk'
import idl from '../idl/heres_program.json'
import { getSolanaConnection } from '@/config/solana'
import { getCapsulePDA, getCapsuleVaultPDA, getBeneficiarySetPDA } from './program'
import { decodeBeneficiarySet } from './lean-capsule'
import { getDueOwners, getRegisteredOwners, setCapsuleDue, unregisterCapsuleOwner } from './capsule-registry'
import { MAGICBLOCK_ER, PER_TEE } from '@/constants'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

const DELEGATION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
const PERMISSION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.PERMISSION_PROGRAM_ID)
const MAGIC_CONTEXT_ID = new PublicKey(MAGICBLOCK_ER.MAGIC_CONTEXT)
const MAGIC_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID)

// distribute_assets is gated on-chain by this post-fire grace window (constants.rs GRACE_PERIOD).
const GRACE_PERIOD = 48 * 60 * 60

// Workstream A: the Switch lives on a REGULAR ER (token-free), so crank_undelegate goes here. Defaults
// to the regular ER RPC. The TEE is only touched for the rare BeneficiarySet reveal (see below).
const CRANK_ER_RPC_URL = process.env.CRANK_ER_RPC_URL || MAGICBLOCK_ER.ER_RPC_URL

const accountsCoder = new BorshAccountsCoder(idl as any)

// SDK permission seed is "permission:" (with the colon - Permission::find_pda). The permission is now
// derived from the BeneficiarySet PDA (the only TEE-delegated account), not the Switch.
function permissionPda(account: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('permission:'), account.toBuffer()], PERMISSION_PROGRAM_ID)[0]
}

// ---- Server-side TEE auth token (BeneficiarySet reveal only) ----------------------------------------
//
// The hot path (heartbeats, Switch undelegate) is token-free. Only the rare privacy reveal -
// crank_undelegate_beneficiaries, run once per fired capsule after the grace window - touches the TEE,
// which requires a per-key auth token. The crank wallet mints its own with nacl (no browser wallet).
// An operator can instead pin a pre-authed URL via CRANK_TEE_RPC_URL (...&token=...).
let crankTeeTokenCache: string | null = null

async function getCrankTeeToken(crankKeypair: Keypair, forceRefresh = false): Promise<string> {
  const pinned = process.env.CRANK_TEE_RPC_URL?.match(/[?&]token=([^&]+)/)?.[1]
  if (pinned) return decodeURIComponent(pinned)
  if (crankTeeTokenCache && !forceRefresh) return crankTeeTokenCache
  const signMessage = async (msg: Uint8Array) => nacl.sign.detached(msg, crankKeypair.secretKey)
  const { token } = await getAuthToken(PER_TEE.AUTH_URL, crankKeypair.publicKey, signMessage)
  crankTeeTokenCache = token
  return token
}

function teeRpcUrl(token: string): string {
  if (process.env.CRANK_TEE_RPC_URL) return process.env.CRANK_TEE_RPC_URL
  return `${PER_TEE.RPC_URL}?token=${token}`
}

function ata(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0]
}

function createAtaIx(payer: PublicKey, ataAddr: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ataAddr, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  })
}

function makeWallet(keypair: Keypair): Wallet {
  return {
    publicKey: keypair.publicKey,
    payer: keypair,
    signTransaction: async (tx: any) => {
      tx.sign(keypair)
      return tx
    },
    signAllTransactions: async (txs: any[]) => {
      txs.forEach((tx) => tx.sign(keypair))
      return txs
    },
  } as unknown as Wallet
}

function crankProgram(connection: Connection, keypair: Keypair): Program {
  const provider = new AnchorProvider(connection, makeWallet(keypair), { commitment: 'confirmed' })
  return new Program(idl as any, provider)
}

/** Build, sign, and confirm a base-layer transaction (skipPreflight - the lean binary is fine). */
async function sendRaw(
  connection: Connection,
  keypair: Keypair,
  instructions: TransactionInstruction[]
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: keypair.publicKey, blockhash, lastValidBlockHeight })
  instructions.forEach((ix) => tx.add(ix))
  tx.sign(keypair)
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true })
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  return sig
}

/**
 * Submit a tx to the ER and confirm by polling signature status. The ER may not simulate the cloned
 * program cleanly, so skipPreflight; HTTP status polling avoids any WS-subscription token edge cases
 * on a token-authed (TEE) endpoint.
 */
async function sendEr(
  connection: Connection,
  keypair: Keypair,
  instructions: TransactionInstruction[]
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: keypair.publicKey, blockhash, lastValidBlockHeight })
  instructions.forEach((ix) => tx.add(ix))
  tx.sign(keypair)
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

type LeanBeneficiary = { pubkey: PublicKey; shareBps: number }
type LeanCapsule = {
  owner: PublicKey
  inactivityPeriod: number
  lastActivity: number
  isActive: boolean
  executedAt: number | null
  vaultBump: number
  targetDate: number | null
}

/**
 * Decode a base-layer (undelegated, program-owned) Switch with the lean IDL layout. Liveness only -
 * the beneficiary list now lives in the BeneficiarySet (decoded separately for distribution).
 */
function decodeLeanCapsule(data: Buffer): LeanCapsule {
  const c = accountsCoder.decode('IntentCapsule', data) as any
  return {
    owner: c.owner,
    inactivityPeriod: c.inactivity_period.toNumber(),
    lastActivity: c.last_activity.toNumber(),
    isActive: c.is_active,
    executedAt: c.executed_at == null ? null : c.executed_at.toNumber(),
    vaultBump: c.vault_bump,
    targetDate: c.target_date == null ? null : c.target_date.toNumber(),
  }
}

type BaseInfo = { accountOwner: PublicKey; data: Buffer }
type OwnerBaseInfos = { switch: BaseInfo | null; benSet: BaseInfo | null }

/**
 * Batch-fetch BASE account infos for many owners - both the Switch and the BeneficiarySet (two reads
 * per owner, batched <=100 keys per getMultipleAccountsInfo). The crank reads ONLY the base layer; an
 * account's base owner tells us delegated (owner = delegation program) vs settled-on-base. The Switch
 * (regular ER) and the BeneficiarySet (TEE) are delegated independently, so each is tracked separately:
 * the two-step undelegate sequences off whichever is still delegated.
 */
async function fetchBaseInfos(owners: string[]): Promise<Map<string, OwnerBaseInfos>> {
  const out = new Map<string, OwnerBaseInfos>()
  const connection = getSolanaConnection()

  const targets: { ownerStr: string; capsulePDA: PublicKey; benSetPDA: PublicKey }[] = []
  for (const ownerStr of owners) {
    try {
      const ownerKey = new PublicKey(ownerStr)
      const [capsulePDA] = getCapsulePDA(ownerKey)
      const [benSetPDA] = getBeneficiarySetPDA(ownerKey)
      targets.push({ ownerStr, capsulePDA, benSetPDA })
    } catch {
      // skip unparseable owner string
    }
  }

  const CHUNK = 50 // 2 accounts per owner -> <=100 keys per RPC call
  for (let i = 0; i < targets.length; i += CHUNK) {
    const slice = targets.slice(i, i + CHUNK)
    const keys: PublicKey[] = []
    for (const t of slice) keys.push(t.capsulePDA, t.benSetPDA)
    const infos = await connection.getMultipleAccountsInfo(keys, 'confirmed')
    for (let j = 0; j < slice.length; j++) {
      const sw = infos[2 * j]
      const bs = infos[2 * j + 1]
      out.set(slice[j].ownerStr, {
        switch: sw ? { accountOwner: sw.owner, data: sw.data } : null,
        benSet: bs ? { accountOwner: bs.owner, data: bs.data } : null,
      })
    }
  }
  return out
}

/** execute_intent (lean: exactly [capsule]). State-only fire; no funds move; no PER permission. */
function executeIntentIx(program: Program, owner: PublicKey): Promise<TransactionInstruction> {
  const [capsule] = getCapsulePDA(owner)
  return program.methods.executeIntent().accountsPartial({ capsule }).instruction()
}

/**
 * crank_undelegate (Switch only, 5 accounts). The Switch is on a regular ER with NO PER permission, so
 * this is a plain commit+undelegate back to base. Gated on-chain to owner-or-fired.
 */
function crankUndelegateIx(program: Program, payer: PublicKey, owner: PublicKey): Promise<TransactionInstruction> {
  const [capsule] = getCapsulePDA(owner)
  return program.methods
    .crankUndelegate()
    .accountsPartial({
      payer,
      owner,
      capsule,
      magicContext: MAGIC_CONTEXT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction()
}

/**
 * crank_undelegate_beneficiaries (the TEE privacy reveal, 8 accounts). Commits the BeneficiarySet's TEE
 * state and undelegates it (+ its PER permission) back to base. Gated on-chain: permissionless only once
 * the Switch has fired AND is already back on base (so this MUST run after crank_undelegate has settled).
 */
function crankUndelegateBeneficiariesIx(
  program: Program,
  payer: PublicKey,
  owner: PublicKey
): Promise<TransactionInstruction> {
  const [capsule] = getCapsulePDA(owner)
  const [benSet] = getBeneficiarySetPDA(owner)
  return program.methods
    .crankUndelegateBeneficiaries()
    .accountsPartial({
      payer,
      owner,
      beneficiarySet: benSet,
      switch: capsule,
      permission: permissionPda(benSet),
      permissionProgram: PERMISSION_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction()
}

/** True when a failed crank undelegate was rejected by the owner-or-fired gate rather than a real error. */
function isNotFiredError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e)
  // ErrorCode::CapsuleActive = 6002 (anchor custom error base 6000); the gate rejects pre-fire undelegate.
  return m.includes('6002') || /CapsuleActive/i.test(m)
}

/**
 * Pay out every asset the Vault holds to the on-chain beneficiaries, split by share_bps. SPL legs run
 * first (each closes the vault ATA, returning its rent to the Vault); the SOL leg runs last so it
 * sweeps the reclaimed rent too. Returns true once the Vault is fully drained (safe to unregister).
 */
async function distributeAll(
  connection: Connection,
  program: Program,
  keypair: Keypair,
  owner: PublicKey,
  beneficiaries: LeanBeneficiary[]
): Promise<boolean> {
  if (beneficiaries.length === 0) throw new Error('capsule has no beneficiaries')
  const [capsulePDA] = getCapsulePDA(owner)
  const [benSetPDA] = getBeneficiarySetPDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const recipients = beneficiaries

  // 1. SPL legs first.
  const tokenAccts = await connection.getParsedTokenAccountsByOwner(vaultPDA, { programId: TOKEN_PROGRAM_ID })
  for (const { pubkey: vaultAta, account } of tokenAccts.value) {
    const tokenInfo = (account.data as any).parsed?.info
    if (!tokenInfo) continue
    if (BigInt(tokenInfo.tokenAmount.amount) === 0n) continue
    const mint = new PublicKey(tokenInfo.mint)

    const preIxs: TransactionInstruction[] = []
    const remaining = [] as { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
    for (const b of recipients) {
      const bAta = ata(mint, b.pubkey)
      const exists = await connection.getAccountInfo(bAta)
      if (!exists) preIxs.push(createAtaIx(keypair.publicKey, bAta, b.pubkey, mint))
      remaining.push({ pubkey: bAta, isSigner: false, isWritable: true })
    }

    const ix = await program.methods
      .distributeAssets()
      .accountsPartial({
        capsule: capsulePDA,
        beneficiarySet: benSetPDA,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        mint,
        vaultTokenAccount: vaultAta,
      })
      .remainingAccounts(remaining)
      .instruction()
    await sendRaw(connection, keypair, [...preIxs, ix])
  }

  // 2. SOL leg last (sweeps lamports incl. reclaimed ATA rent).
  const vaultInfo = await connection.getAccountInfo(vaultPDA)
  if (vaultInfo) {
    const rentFloor = await connection.getMinimumBalanceForRentExemption(vaultInfo.data.length)
    if (vaultInfo.lamports > rentFloor) {
      const remaining = recipients.map((b) => ({ pubkey: b.pubkey, isSigner: false, isWritable: true }))
      const ix = await program.methods
        .distributeAssets()
        // null optional accounts -> Anchor encodes the program-id None sentinel (proven by recover_vault/deposit).
        // The generated TS type omits null, so cast; the IDL is already loaded untyped (idl as any).
        .accountsPartial({
          capsule: capsulePDA,
          beneficiarySet: benSetPDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: null,
          mint: null,
          vaultTokenAccount: null,
        } as any)
        .remainingAccounts(remaining)
        .instruction()
      await sendRaw(connection, keypair, [ix])
    }
  }

  // 3. Drained?
  const finalVault = await connection.getAccountInfo(vaultPDA)
  const finalTokens = await connection.getParsedTokenAccountsByOwner(vaultPDA, { programId: TOKEN_PROGRAM_ID })
  const rentFloor = finalVault ? await connection.getMinimumBalanceForRentExemption(finalVault.data.length) : 0
  const solDrained = !finalVault || finalVault.lamports <= rentFloor
  const tokensDrained = finalTokens.value.every(
    (t) => BigInt((t.account.data as any).parsed.info.tokenAmount.amount) === 0n
  )
  return solDrained && tokensDrained
}

export type PipelineResult = {
  ok: boolean
  dueSelected: number
  fullScan: boolean
  scanned: number
  executedBase: number
  executedEr: number
  undelegated: number
  /** BeneficiarySet TEE -> base reveals (crank_undelegate_beneficiaries) this tick. */
  revealed: number
  distributed: number
  errors: string[]
}

/**
 * Owners the crank should look at this tick. M2 hot path: the due-time index returns only capsules
 * whose fire-time has passed; a backend hiccup falls back to a full scan so a fire is never stranded.
 */
async function selectDueOwners(now: number): Promise<{ owners: string[]; fullScan: boolean }> {
  try {
    return { owners: await getDueOwners(now), fullScan: false }
  } catch {
    return { owners: await getRegisteredOwners(), fullScan: true }
  }
}

/**
 * Unified dead-man's-switch crank for the LEAN program (Workstream A: Switch on a regular ER, the
 * private BeneficiarySet on the TEE, Vault on base).
 *
 * Reads ONLY the base layer, tracking the Switch and the BeneficiarySet independently (each is
 * delegated to a different ER). The hot path is TOKEN-FREE; the TEE auth token is minted lazily and
 * used only for the rare privacy reveal. The two-step undelegate is the crux: the BeneficiarySet's
 * reveal is gated on the Switch already being fired + back on base, so the Switch must undelegate
 * first. State machine per due capsule:
 *
 *   switch delegated                  -> optimistically crank_undelegate on the regular ER (token-free).
 *                                        Fired-gate no-ops pre-fire; the autonomous ScheduleTask fires.
 *   switch base + active + elapsed     -> execute_intent on base (never-delegated / pre-delegation path).
 *   switch base + active + not-elapsed -> self-heal the due index from the real on-chain fire-time.
 *   switch base + fired + in grace     -> wait (set due index to grace end). BeneficiarySet STAYS on
 *                                        the TEE - the list is never revealed until payout time.
 *   switch base + fired + grace done:
 *       benSet delegated  -> crank_undelegate_beneficiaries on the TEE (the privacy reveal; token).
 *       benSet on base    -> distribute every Vault asset to the now-public list, then unregister.
 *
 * On-chain guards make every step idempotent (structural drain-and-close, not a flag), so a mid-tick
 * failure is recovered on the next tick.
 */
export async function runCrankPipeline(crankKeypair: Keypair): Promise<PipelineResult> {
  const connection = getSolanaConnection()
  const now = Math.floor(Date.now() / 1000)
  const { owners, fullScan } = await selectDueOwners(now)

  const result: PipelineResult = {
    ok: true,
    dueSelected: owners.length,
    fullScan,
    scanned: 0,
    executedBase: 0,
    executedEr: 0,
    undelegated: 0,
    revealed: 0,
    distributed: 0,
    errors: [],
  }

  let infos: Map<string, OwnerBaseInfos>
  try {
    infos = await fetchBaseInfos(owners)
  } catch (e) {
    result.ok = false
    result.errors.push(`base fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    return result
  }

  const baseProgram = crankProgram(connection, crankKeypair)
  const erConnection = new Connection(CRANK_ER_RPC_URL, { commitment: 'confirmed' })
  const erProgram = crankProgram(erConnection, crankKeypair)

  // The TEE connection/program is built lazily (token minted on first reveal) so live capsules never
  // pay the auth round-trip. Re-minted once on an auth failure.
  let teeConn: Connection | null = null
  let teeProgram: Program | null = null
  const ensureTee = async (forceToken = false): Promise<{ conn: Connection; prog: Program }> => {
    if (forceToken) {
      teeConn = null
      teeProgram = null
    }
    if (!teeConn || !teeProgram) {
      const token = await getCrankTeeToken(crankKeypair, forceToken)
      teeConn = new Connection(teeRpcUrl(token), { commitment: 'confirmed' })
      teeProgram = crankProgram(teeConn, crankKeypair)
    }
    return { conn: teeConn, prog: teeProgram }
  }

  for (const ownerStr of owners) {
    let owner: PublicKey
    try {
      owner = new PublicKey(ownerStr)
    } catch {
      continue
    }

    const info = infos.get(ownerStr)
    if (!info || !info.switch) continue // Switch account not found on base yet
    result.scanned += 1

    try {
      // ---- Switch still delegated to the regular ER: optimistically undelegate it ----
      if (info.switch.accountOwner.equals(DELEGATION_PROGRAM_ID)) {
        const ix = await crankUndelegateIx(erProgram, crankKeypair.publicKey, owner)
        try {
          await sendEr(erConnection, crankKeypair, [ix])
          result.undelegated += 1
        } catch (e) {
          if (!isNotFiredError(e)) throw e
          // not yet fired -> nothing to do this tick
        }
        continue
      }

      // ---- Switch settled on base (program-owned): state is public, decode it ----
      const cap = decodeLeanCapsule(info.switch.data)

      if (cap.isActive) {
        // Fires on EITHER trigger, so the due time is the earlier of the inactivity deadline and the
        // absolute target_date (if set). target_date is fixed; the inactivity deadline slides forward
        // on every heartbeat, so once it passes target_date the date becomes the binding constraint.
        const inactivityDueAt = cap.lastActivity + cap.inactivityPeriod
        const dueAt = cap.targetDate != null ? Math.min(inactivityDueAt, cap.targetDate) : inactivityDueAt
        if (now >= dueAt) {
          // Never-delegated (or pre-delegation) Switch that is due: fire on base.
          await sendRaw(connection, crankKeypair, [await executeIntentIx(baseProgram, owner)])
          result.executedBase += 1
        } else {
          await setCapsuleDue(ownerStr, dueAt)
        }
        continue
      }

      if (cap.executedAt == null) continue // inactive and never executed -> anomaly, skip.

      // ---- Fired Switch on base. Hold the reveal until the grace window elapses ----
      const graceEnd = cap.executedAt + GRACE_PERIOD
      if (now < graceEnd) {
        await setCapsuleDue(ownerStr, graceEnd) // BeneficiarySet stays private on the TEE until payout
        continue
      }

      // ---- Grace elapsed: reveal the BeneficiarySet (if still on the TEE), else distribute ----
      const benSetDelegated = !!info.benSet && info.benSet.accountOwner.equals(DELEGATION_PROGRAM_ID)
      if (benSetDelegated) {
        // Privacy reveal: commit + undelegate the BeneficiarySet from the TEE back to base. Gated
        // on-chain by the now-fired, base-resident Switch (read inside the instruction).
        try {
          const { conn, prog } = await ensureTee()
          await sendEr(conn, crankKeypair, [await crankUndelegateBeneficiariesIx(prog, crankKeypair.publicKey, owner)])
          result.revealed += 1
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e)
          if (/401|unauthor|invalid token|auth/i.test(m)) {
            // Token likely expired -> re-mint once and retry the reveal.
            const { conn, prog } = await ensureTee(true)
            await sendEr(conn, crankKeypair, [await crankUndelegateBeneficiariesIx(prog, crankKeypair.publicKey, owner)])
            result.revealed += 1
          } else {
            throw e
          }
        }
        continue // BeneficiarySet settles to base; distribute on a later tick
      }

      // BeneficiarySet is on base (revealed): decode the now-public list and pay out.
      if (!info.benSet) {
        result.errors.push(`${ownerStr}: fired + grace elapsed but BeneficiarySet account missing`)
        continue
      }
      const beneficiaries = decodeBeneficiarySet(info.benSet.data).beneficiaries
      const drained = await distributeAll(connection, baseProgram, crankKeypair, owner, beneficiaries)
      result.distributed += 1
      if (drained) await unregisterCapsuleOwner(ownerStr)
    } catch (e) {
      result.ok = false
      result.errors.push(`${ownerStr}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}

// Backward-compatible alias: existing cron routes import runCrank.
export async function runCrank(crankKeypair: Keypair): Promise<PipelineResult> {
  return runCrankPipeline(crankKeypair)
}

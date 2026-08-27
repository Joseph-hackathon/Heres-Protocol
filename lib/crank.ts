import dns from 'dns'
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

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
import { getCapsulePDA, getCapsuleVaultPDA, getBeneficiarySetPDA, getFeeConfigPDA } from './program'
import { decodeBeneficiarySet } from './lean-capsule'
import { getDueOwners, getRegisteredOwners, setCapsuleDue, unregisterCapsuleOwner } from './capsule-registry'
import { MAGICBLOCK_ER, PER_TEE } from '@/constants'
import { ataFor, buildCreateAtaIx, getVaultTokenAccounts } from '@/lib/spl'
import { confirmTransactionOrThrow } from '@/lib/transaction-confirmation'
import { dispatchIntentDeliveryForCapsule } from '@/lib/intent-delivery/service'

const DELEGATION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
const PERMISSION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.PERMISSION_PROGRAM_ID)
const MAGIC_CONTEXT_ID = new PublicKey(MAGICBLOCK_ER.MAGIC_CONTEXT)
const MAGIC_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID)

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
// The hot path (heartbeats, Switch undelegate) is token-free. Only the privacy reveal -
// crank_undelegate_beneficiaries, run once per fired capsule - touches the TEE,
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
  await confirmTransactionOrThrow(connection, { signature: sig, blockhash, lastValidBlockHeight })
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
type LeanNftAssignment = { mint: PublicKey; recipient: PublicKey }
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
  beneficiaries: LeanBeneficiary[],
  nftAssignments: LeanNftAssignment[]
): Promise<boolean> {
  if (beneficiaries.length === 0) throw new Error('capsule has no beneficiaries')
  const [capsulePDA] = getCapsulePDA(owner)
  const [benSetPDA] = getBeneficiarySetPDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const recipients = beneficiaries

  // 1. SPL legs first - scan BOTH token programs (classic SPL + Token-2022).
  const vaultTokens = await getVaultTokenAccounts(connection, vaultPDA)
  for (const { ata: vaultAta, mint, amount, decimals, tokenProgram } of vaultTokens) {
    if (amount === 0n) continue

    // The private assignment is the authoritative NFT classifier. Never route an assigned mint
    // through proportional division, where rounding could send the indivisible unit to another heir.
    const assignment = nftAssignments.find((item) => item.mint.equals(mint))
    if (assignment) {
      const supply = await connection.getTokenSupply(mint, 'confirmed')
      if (decimals !== 0 || supply.value.amount !== '1' || supply.value.decimals !== 0) {
        throw new Error(`Assigned NFT ${mint.toBase58()} is not a supply-1, decimals-0 mint`)
      }
      if (amount !== 1n) throw new Error(`NFT ${mint.toBase58()} vault balance is not exactly one`)

      const recipientAta = ataFor(mint, assignment.recipient, tokenProgram)
      const preIxs: TransactionInstruction[] = []
      if (!(await connection.getAccountInfo(recipientAta))) {
        preIxs.push(
          buildCreateAtaIx(keypair.publicKey, recipientAta, assignment.recipient, mint, tokenProgram)
        )
      }
      const ix = await program.methods
        .distributeNft(assignment.recipient)
        .accountsPartial({
          capsule: capsulePDA,
          beneficiarySet: benSetPDA,
          vault: vaultPDA,
          tokenProgram,
          mint,
          vaultTokenAccount: vaultAta,
          recipientTokenAccount: recipientAta,
        })
        .instruction()
      await sendRaw(connection, keypair, [...preIxs, ix])
      continue
    }

    const preIxs: TransactionInstruction[] = []
    const remaining = [] as { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
    for (const b of recipients) {
      const bAta = ataFor(mint, b.pubkey, tokenProgram)
      const exists = await connection.getAccountInfo(bAta)
      if (!exists) preIxs.push(buildCreateAtaIx(keypair.publicKey, bAta, b.pubkey, mint, tokenProgram))
      remaining.push({ pubkey: bAta, isSigner: false, isWritable: true })
    }

    const ix = await program.methods
      .distributeAssets()
      .accountsPartial({
        capsule: capsulePDA,
        beneficiarySet: benSetPDA,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram,
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

  // 3. Drained? Check both token programs.
  const finalVault = await connection.getAccountInfo(vaultPDA)
  const finalTokens = await getVaultTokenAccounts(connection, vaultPDA)
  const rentFloor = finalVault ? await connection.getMinimumBalanceForRentExemption(finalVault.data.length) : 0
  const solDrained = !finalVault || finalVault.lamports <= rentFloor
  const tokensDrained = finalTokens.every((t) => t.amount === 0n)
  return solDrained && tokensDrained
}

/** Close the settled core PDAs. FeeConfig pins the rent destination on-chain. */
async function finalizeCapsuleAccounts(
  connection: Connection,
  program: Program,
  keypair: Keypair,
  owner: PublicKey
): Promise<string> {
  const [capsulePDA] = getCapsulePDA(owner)
  const [benSetPDA] = getBeneficiarySetPDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const [feeConfigPDA] = getFeeConfigPDA()
  const feeConfig = await (program.account as any).feeConfig.fetch(feeConfigPDA)
  const feeRecipientRaw = feeConfig.feeRecipient ?? feeConfig.fee_recipient
  if (!feeRecipientRaw) throw new Error('protocol fee recipient is not configured')
  const feeRecipient = new PublicKey(feeRecipientRaw)
  const ix = await program.methods
    .finalizeCapsule()
    .accountsPartial({
      capsule: capsulePDA,
      beneficiarySet: benSetPDA,
      vault: vaultPDA,
      authority: keypair.publicKey,
      feeConfig: feeConfigPDA,
      feeRecipient,
    })
    .instruction()
  return sendRaw(connection, keypair, [ix])
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
  finalized: number
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
 * used only for the privacy reveal after firing. The two-step undelegate is the crux: the BeneficiarySet's
 * reveal is gated on the Switch already being fired + back on base, so the Switch must undelegate
 * first. State machine per due capsule:
 *
 *   switch delegated                  -> optimistically crank_undelegate on the regular ER (token-free).
 *                                        Fired-gate no-ops pre-fire; the autonomous ScheduleTask fires.
 *   switch base + active + elapsed     -> execute_intent on base (never-delegated / pre-delegation path).
 *   switch base + active + not-elapsed -> self-heal the due index from the real on-chain fire-time.
 *   switch base + fired:
 *       benSet delegated  -> crank_undelegate_beneficiaries on the TEE (the privacy reveal; token).
 *       benSet on base    -> distribute every Vault asset, deliver any intent statement, finalize,
 *                            then unregister.
 *
 * On-chain guards make every step idempotent (structural drain-and-close, not a flag), so a mid-tick
 * failure is recovered on the next tick.
 */
export async function runCrankPipeline(
  crankKeypair: Keypair,
  options: { maxBatchSize?: number; timeBudgetMs?: number } = {}
): Promise<PipelineResult> {
  const maxBatch = options.maxBatchSize ?? 6
  const timeBudget = options.timeBudgetMs
    ? options.timeBudgetMs
    : 20_000
  const startTime = Date.now()
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
    finalized: 0,
    errors: [],
  }

  let infos: Map<string, OwnerBaseInfos>
  try {
    const selectedBatch = owners.slice(0, maxBatch)
    infos = await fetchBaseInfos(selectedBatch)
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

  const selectedBatch = owners.slice(0, maxBatch)
  for (const ownerStr of selectedBatch) {
    if (Date.now() - startTime > timeBudget) {
      break
    }
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

      // ---- Fired Switch on base: reveal the BeneficiarySet (if still on the TEE), else distribute ----
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
        result.errors.push(`${ownerStr}: fired but BeneficiarySet account missing`)
        continue
      }
      const inheritance = decodeBeneficiarySet(info.benSet.data)
      const drained = await distributeAll(
        connection,
        baseProgram,
        crankKeypair,
        owner,
        inheritance.beneficiaries,
        inheritance.nftAssignments
      )
      result.distributed += 1
      if (!drained) continue

      // Intent delivery needs the live capsule state to derive its idempotency key. It must complete
      // before finalization removes that state. Capsules without an intent statement are explicitly
      // skipped by the delivery service and can be finalized immediately.
      const [capsulePDA] = getCapsulePDA(owner)
      const delivery = await dispatchIntentDeliveryForCapsule(capsulePDA.toBase58())
      const deliveryComplete =
        (delivery.ok && (delivery.status === 'delivered' || delivery.status === 'dispatched')) ||
        (delivery.ok && delivery.skipped && delivery.reason === 'Intent delivery is not enabled')
      if (!deliveryComplete) {
        if (!delivery.ok) {
          result.ok = false
          result.errors.push(`${ownerStr}: intent delivery failed: ${delivery.error ?? 'unknown error'}`)
        }
        continue
      }

      await finalizeCapsuleAccounts(connection, baseProgram, crankKeypair, owner)
      result.finalized += 1
      await unregisterCapsuleOwner(ownerStr)
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

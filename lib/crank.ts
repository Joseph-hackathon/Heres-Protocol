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
import idl from '../idl/heres_program.json'
import { getSolanaConnection } from '@/config/solana'
import { getCapsulePDA, getCapsuleVaultPDA } from './program'
import { getDueOwners, getRegisteredOwners, setCapsuleDue, unregisterCapsuleOwner } from './capsule-registry'
import { MAGICBLOCK_ER } from '@/constants'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

const DELEGATION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
const PERMISSION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.PERMISSION_PROGRAM_ID)
const MAGIC_CONTEXT_ID = new PublicKey(MAGICBLOCK_ER.MAGIC_CONTEXT)
const MAGIC_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID)

// distribute_assets is gated on-chain by this post-fire grace window (constants.rs GRACE_PERIOD).
const GRACE_PERIOD = 48 * 60 * 60

// The ER endpoint the crank submits crank_undelegate to. Defaults to the regular ER. For the
// Private/TEE ER this must be a token-authed URL (mint a crank auth token out of band and set it
// here, e.g. https://devnet-tee.magicblock.app?token=...). TODO: in-crank per-key token minting.
const CRANK_ER_RPC_URL = process.env.CRANK_ER_RPC_URL || MAGICBLOCK_ER.ER_RPC_URL

const accountsCoder = new BorshAccountsCoder(idl as any)

// SDK permission seed is "permission:" (with the colon - Permission::find_pda). The shared
// getPermissionPDA in lib/program.ts uses the colon-less "permission" seed, which is wrong for the
// lean program; derive locally so the crank is correct. (lib/program.ts fix = frontend phase.)
function permissionPda(capsule: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('permission:'), capsule.toBuffer()], PERMISSION_PROGRAM_ID)[0]
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
  beneficiaries: LeanBeneficiary[]
}

/** Decode a base-layer (undelegated, program-owned) Switch with the lean IDL layout. */
function decodeLeanCapsule(data: Buffer): LeanCapsule {
  const c = accountsCoder.decode('IntentCapsule', data) as any
  return {
    owner: c.owner,
    inactivityPeriod: c.inactivity_period.toNumber(),
    lastActivity: c.last_activity.toNumber(),
    isActive: c.is_active,
    executedAt: c.executed_at == null ? null : c.executed_at.toNumber(),
    vaultBump: c.vault_bump,
    beneficiaries: (c.beneficiaries ?? []).map((b: any) => ({ pubkey: b.pubkey, shareBps: b.share_bps })),
  }
}

/**
 * Batch-fetch BASE account infos for many owners (one getMultipleAccountsInfo per 100). The crank
 * deliberately reads ONLY the base layer: a delegated Switch lives in the Private/TEE ER where the
 * Query Filtering Service filters the crank's reads, so its liveness is unreadable here. The base
 * account's owner alone tells us delegated (owner = delegation program) vs settled-on-base.
 */
async function fetchBaseInfos(
  owners: string[]
): Promise<Map<string, { accountOwner: PublicKey; data: Buffer } | null>> {
  const out = new Map<string, { accountOwner: PublicKey; data: Buffer } | null>()
  const connection = getSolanaConnection()

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
      const info = infos[j]
      out.set(slice[j].ownerStr, info ? { accountOwner: info.owner, data: info.data } : null)
    }
  }
  return out
}

/** execute_intent (lean: capsule, permission_program, permission). State-only fire; no funds move. */
function executeIntentIx(program: Program, owner: PublicKey): Promise<TransactionInstruction> {
  const [capsule] = getCapsulePDA(owner)
  return program.methods
    .executeIntent()
    .accountsPartial({
      capsule,
      permissionProgram: PERMISSION_PROGRAM_ID,
      permission: permissionPda(capsule),
    })
    .instruction()
}

/** crank_undelegate (lean accounts). Commits ER state + returns the Switch (and permission) to base. */
function crankUndelegateIx(program: Program, payer: PublicKey, owner: PublicKey): Promise<TransactionInstruction> {
  const [capsule] = getCapsulePDA(owner)
  return program.methods
    .crankUndelegate()
    .accountsPartial({
      payer,
      owner,
      capsule,
      permission: permissionPda(capsule),
      permissionProgram: PERMISSION_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction()
}

/** True when a failed crank_undelegate was rejected by the fired-gate (not yet fired) rather than a real error. */
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
  cap: LeanCapsule
): Promise<boolean> {
  if (cap.beneficiaries.length === 0) throw new Error('capsule has no beneficiaries')
  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const recipients = cap.beneficiaries

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
 * Unified dead-man's-switch crank for the LEAN program (Model A: delegated Switch + base Vault).
 *
 * Reads ONLY the base layer. The Switch is delegated to the Private/TEE ER from creation, where the
 * crank's reads are filtered, so it cannot see a delegated Switch's liveness - and it does not need
 * to. Firing a delegated Switch is the autonomous MagicBlock ScheduleTask's job. The crank's state
 * machine, per due capsule:
 *
 *   delegated                      -> optimistically crank_undelegate on the ER. The on-chain
 *                                     fired-gate makes a pre-fire attempt a safe no-op; once the
 *                                     ScheduleTask has fired it, this commits the Switch back to base.
 *   base + active + elapsed        -> execute_intent on base (never-delegated / pre-delegation path).
 *   base + active + not-elapsed    -> self-heal the due index from the real on-chain fire-time.
 *   base + fired + grace elapsed   -> distribute every Vault asset, then unregister once drained.
 *   base + fired + in grace        -> wait; set the due index to the grace end.
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
    distributed: 0,
    errors: [],
  }

  let infos: Map<string, { accountOwner: PublicKey; data: Buffer } | null>
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

  for (const ownerStr of owners) {
    let owner: PublicKey
    try {
      owner = new PublicKey(ownerStr)
    } catch {
      continue
    }

    const info = infos.get(ownerStr)
    if (!info) continue // capsule account not found on base yet
    result.scanned += 1

    try {
      if (info.accountOwner.equals(DELEGATION_PROGRAM_ID)) {
        // Delegated: liveness is unreadable here. Optimistically undelegate; the fired-gate no-ops
        // pre-fire. Firing itself is the autonomous ScheduleTask, not the crank.
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

      // Settled on base (program-owned): state is public, decode it.
      const cap = decodeLeanCapsule(info.data)

      if (cap.isActive) {
        const dueAt = cap.lastActivity + cap.inactivityPeriod
        if (now >= dueAt) {
          // Never-delegated (or pre-delegation) Switch that is due: fire on base.
          await sendRaw(connection, crankKeypair, [await executeIntentIx(baseProgram, owner)])
          result.executedBase += 1
        } else {
          await setCapsuleDue(ownerStr, dueAt)
        }
      } else if (cap.executedAt != null) {
        const graceEnd = cap.executedAt + GRACE_PERIOD
        if (now >= graceEnd) {
          const drained = await distributeAll(connection, baseProgram, crankKeypair, owner, cap)
          result.distributed += 1
          if (drained) await unregisterCapsuleOwner(ownerStr)
        } else {
          await setCapsuleDue(ownerStr, graceEnd) // wait out the post-fire grace window
        }
      }
      // else: inactive and never executed -> anomaly, skip.
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

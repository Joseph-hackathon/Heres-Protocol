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
import { getSolanaConnection, getProgramId } from '@/config/solana'
import { getCapsulePDA, getCapsuleVaultPDA, getFeeConfigPDA, getPermissionPDA } from './program'
import { fetchCapsuleStatesBatched, type DecodedCapsuleState } from './cre/solana'
import { getDueOwners, getRegisteredOwners, setCapsuleDue, unregisterCapsuleOwner } from './capsule-registry'
import { MAGICBLOCK_ER, SOLANA_CONFIG } from '@/constants'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

// Instruction discriminators (deployed binary). execute_intent + distribute_assets are sent as
// raw instructions because the base binary accepts the optional accounts as sentinels.
const EXECUTE_INTENT_DISC = Buffer.from([53, 130, 47, 154, 227, 220, 122, 212])
const DISTRIBUTE_ASSETS_DISC = Buffer.from([239, 241, 19, 219, 144, 191, 154, 18])

const DELEGATION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
const PERMISSION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.PERMISSION_PROGRAM_ID)
const FALLBACK_FEE_RECIPIENT = new PublicKey(
  SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT || 'Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb'
)

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

type SolanaBeneficiary = { address: string }

/** Beneficiary wallets on Solana (EVM heirs are settled via the CcipTransferRequested event). */
function parseSolanaBeneficiaries(intentData: Uint8Array): SolanaBeneficiary[] {
  try {
    const json = new TextDecoder().decode(intentData)
    const data = JSON.parse(json) as {
      beneficiaries?: Array<{ address?: string; chain?: string }>
    }
    const list = data?.beneficiaries
    if (!Array.isArray(list)) return []
    return list
      .filter((b) => b?.address && (b.chain ?? 'solana') === 'solana')
      .map((b) => ({ address: b.address! }))
  } catch {
    return []
  }
}

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

/** execute_intent (4 accounts). Flips capsule state; no funds move. */
function buildExecuteIntentIx(owner: PublicKey): TransactionInstruction {
  const programId = getProgramId()
  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const [permissionPDA] = getPermissionPDA(capsulePDA, PERMISSION_PROGRAM_ID)
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: capsulePDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: PERMISSION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: permissionPDA, isSigner: false, isWritable: false },
    ],
    data: EXECUTE_INTENT_DISC,
  })
}

async function executeOnBase(connection: Connection, keypair: Keypair, owner: PublicKey): Promise<string> {
  return sendRaw(connection, keypair, [buildExecuteIntentIx(owner)])
}

async function executeOnEr(keypair: Keypair, owner: PublicKey): Promise<string> {
  const erConnection = new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
  return sendRaw(erConnection, keypair, [buildExecuteIntentIx(owner)])
}

/** crank_undelegate: commits ER state and returns capsule ownership to the base layer. */
async function undelegate(connection: Connection, keypair: Keypair, owner: PublicKey): Promise<string> {
  const provider = new AnchorProvider(connection, makeWallet(keypair), { commitment: 'confirmed' })
  const program = new Program(idl as any, provider)
  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  // @ts-ignore - method resolved from IDL
  return program.methods
    .crankUndelegate()
    .accounts({
      payer: keypair.publicKey,
      capsule: capsulePDA,
      vault: vaultPDA,
      magicContext: new PublicKey(MAGICBLOCK_ER.MAGIC_CONTEXT),
      magicProgram: new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID),
    })
    .rpc()
}

async function resolveFeeRecipient(connection: Connection): Promise<PublicKey> {
  try {
    const [feeConfigPDA] = getFeeConfigPDA()
    const info = await connection.getAccountInfo(feeConfigPDA)
    if (info) {
      const coder = new BorshAccountsCoder(idl as any)
      const fee = coder.decode('FeeConfig', info.data) as any
      const recipient = fee.fee_recipient ?? fee.feeRecipient
      if (recipient) return new PublicKey(recipient)
    }
  } catch {
    // fall through to configured default
  }
  return FALLBACK_FEE_RECIPIENT
}

/**
 * distribute_assets: moves SOL/SPL from the vault to beneficiaries on the base layer.
 * Requires the capsule to be undelegated (back on the base layer) and already executed.
 * On-chain H1 guard makes redundant calls safe; this is the permissionless payout crank.
 */
async function distribute(
  connection: Connection,
  keypair: Keypair,
  state: DecodedCapsuleState
): Promise<string> {
  const owner = state.owner
  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const [feeConfigPDA] = getFeeConfigPDA()
  const programId = getProgramId()
  const isSpl = state.mint && !state.mint.equals(PublicKey.default)

  const beneficiaries = parseSolanaBeneficiaries(state.intentData)
  if (beneficiaries.length === 0) throw new Error('no Solana beneficiaries in intent data')

  const feeRecipient = await resolveFeeRecipient(connection)
  const preInstructions: TransactionInstruction[] = []

  // Fee recipient account: ATA for SPL (create if missing), plain pubkey for SOL.
  let feeRecipientAccount = feeRecipient
  if (isSpl) {
    feeRecipientAccount = ata(state.mint, feeRecipient)
    const exists = await connection.getAccountInfo(feeRecipientAccount)
    if (!exists) {
      preInstructions.push(createAtaIx(keypair.publicKey, feeRecipientAccount, feeRecipient, state.mint))
    }
  }

  // Beneficiary accounts. SPL beneficiaries need an ATA; create any that are missing so a
  // crypto-naive heir receives funds without taking any action (the crank pays the rent).
  const remainingAccounts = [] as { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
  for (const b of beneficiaries) {
    const beneficiaryOwner = new PublicKey(b.address)
    if (isSpl) {
      const beneficiaryAta = ata(state.mint, beneficiaryOwner)
      const exists = await connection.getAccountInfo(beneficiaryAta)
      if (!exists) {
        preInstructions.push(createAtaIx(keypair.publicKey, beneficiaryAta, beneficiaryOwner, state.mint))
      }
      remainingAccounts.push({ pubkey: beneficiaryAta, isSigner: false, isWritable: true })
    } else {
      remainingAccounts.push({ pubkey: beneficiaryOwner, isSigner: false, isWritable: true })
    }
  }

  // Optional accounts use the program id as the None sentinel (matches the deployed binary).
  // capsule MUST be writable: distribute_assets sets capsule.distributed = true (audit H1).
  const keys = [
    { pubkey: capsulePDA, isSigner: false, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: feeConfigPDA, isSigner: false, isWritable: false },
    { pubkey: feeRecipientAccount, isSigner: false, isWritable: true },
    { pubkey: isSpl ? state.mint : programId, isSigner: false, isWritable: false },
    { pubkey: isSpl ? ata(state.mint, vaultPDA) : programId, isSigner: false, isWritable: !!isSpl },
    ...remainingAccounts,
  ]

  const ix = new TransactionInstruction({ keys, programId, data: DISTRIBUTE_ASSETS_DISC })
  return sendRaw(connection, keypair, [...preInstructions, ix])
}

export type CapsuleAction = 'executed-base' | 'executed-er' | 'undelegated' | 'distributed' | 'done' | 'waiting'

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
 * Owners the crank should look at this tick. M2 hot path: the due-time index
 * returns only capsules whose fire-time has passed, so armed-but-not-due capsules
 * are never fetched. If the index read fails, fall back to a full scan over the
 * flat registry (correct, just more RPC) so a backend hiccup never strands a fire.
 */
async function selectDueOwners(now: number): Promise<{ owners: string[]; fullScan: boolean }> {
  try {
    return { owners: await getDueOwners(now), fullScan: false }
  } catch {
    return { owners: await getRegisteredOwners(), fullScan: true }
  }
}

/**
 * Unified dead-man's-switch crank. Selects only the due capsules (M2 due-time
 * index, full-scan fallback), batch-fetches their state in one RPC per 100, and
 * runs one state-machine step per capsule:
 *
 *   delegated  + active   + elapsed      -> execute on ER (flip state; ScheduleTask backstop)
 *   delegated  + executed                -> undelegate (commit + return ownership to base)
 *   !delegated + active   + elapsed      -> execute on base (flip state)
 *   !delegated + executed + !distributed -> distribute (pay out, then unregister)
 *   active     + !elapsed                -> self-heal due-time, skip until actually due
 *
 * Each capsule advances one step per tick; on-chain guards (H1) make every step idempotent.
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

  // One batched RPC round-trip per 100 due owners (M2) instead of one per owner.
  let states: Map<string, DecodedCapsuleState | null>
  try {
    states = await fetchCapsuleStatesBatched(owners)
  } catch (e) {
    result.ok = false
    result.errors.push(`batch fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    return result
  }

  for (const ownerStr of owners) {
    let ownerPubkey: PublicKey
    try {
      ownerPubkey = new PublicKey(ownerStr)
    } catch {
      continue
    }

    const state = states.get(ownerStr)
    if (!state) continue
    result.scanned += 1

    const delegated = state.accountOwner.equals(DELEGATION_PROGRAM_ID)
    const executed = state.executedAt != null
    const dueAt = state.lastActivity + state.inactivityPeriod
    const elapsed = now >= dueAt

    try {
      if (delegated && state.isActive && elapsed) {
        await executeOnEr(crankKeypair, ownerPubkey)
        result.executedEr += 1
      } else if (delegated && executed) {
        await undelegate(connection, crankKeypair, ownerPubkey)
        result.undelegated += 1
      } else if (!delegated && state.isActive && elapsed) {
        // Base happy path: fire AND pay out in the same tick. execute_intent is state-only
        // (flips is_active=false, stamps executed_at); distribute_assets then moves the funds;
        // unregister drops the capsule. These are separate txs, so a mid-tick failure is
        // recovered idempotently by the two branches below on the next tick (on-chain H1/state
        // guards make every step safe to repeat). This keeps fire->payout to ONE tick, which
        // matters under an infrequent (e.g. daily) cron.
        await executeOnBase(connection, crankKeypair, ownerPubkey)
        result.executedBase += 1
        await distribute(connection, crankKeypair, state)
        result.distributed += 1
        await unregisterCapsuleOwner(ownerStr)
      } else if (!delegated && !state.isActive && executed && !state.distributed) {
        // Recovery: capsule was executed in a prior tick (or brought back via ER undelegate)
        // but not yet paid. Pay out and settle in this tick.
        await distribute(connection, crankKeypair, state)
        result.distributed += 1
        await unregisterCapsuleOwner(ownerStr)
      } else if (!delegated && executed && state.distributed) {
        // Fully settled: drop from the registry so future ticks skip it.
        await unregisterCapsuleOwner(ownerStr)
      } else if (state.isActive && !elapsed) {
        // Not due yet (a freshly seeded entry, clock skew, or an owner heartbeat
        // that extended the deadline). Self-heal: record the true fire-time so the
        // due index excludes this capsule until then. Once a capsule crosses its
        // due-time its score stays in the past, so it remains selected every tick
        // until it is fully settled and unregistered above. (M2 scale invariant.)
        await setCapsuleDue(ownerStr, dueAt)
      }
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

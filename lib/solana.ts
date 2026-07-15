/**
 * Solana program interaction utilities (LEAN program: sDRdG2qt...).
 *
 * Model A: the IntentCapsule "Switch" holds the dead-man's-switch state + the private beneficiary
 * list; the CapsuleVault holds the funds and is NEVER delegated. Beneficiaries are set via
 * update_intent (not baked into create_capsule); the vault is funded via deposit; the encrypted human
 * "intent statement" lives off-chain (CRE). Instructions are built with Anchor's methods builder
 * (which encodes discriminators/args from the fresh-build IDL) and sent to the base layer or the ER
 * as appropriate, so account orders can never drift from a hand-maintained table.
 */

import { SystemProgram, PublicKey, Connection, SendTransactionError, Transaction, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js'
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor'
import type { Wallet } from '@coral-xyz/anchor'
import type { HeresWallet } from '@/types/wallet'
import idl from '../idl/heres_program.json'
import { getSolanaConnection, getSolanaFallbackConnection, getTeeConnection, getProgramId } from '@/config/solana'
import {
  getCapsulePDA,
  getFeeConfigPDA,
  getCapsuleVaultPDA,
  getBeneficiarySetPDA,
  getBufferPDA,
  getDelegationRecordPDA,
  getDelegationMetadataPDA,
  getPermissionPDA,
  getRelayerPubkey,
} from './program'
import { SOLANA_CONFIG, PLATFORM_FEE, MAGICBLOCK_ER } from '@/constants'
import { debugLog } from '@/lib/log'
import {
  decodeIntentCapsule,
  tryDecodeIntentCapsule,
  tryDecodeBeneficiarySetData,
} from '@/lib/lean-capsule'
import { getTeeAuthToken, getCachedTeeToken, setCachedTeeToken } from '@/lib/tee'
import type { IntentCapsule, OnChainBeneficiary, OnChainNftAssignment } from '@/types'
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID as SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
  ataFor,
  resolveTokenProgram,
  validateStandardNft,
  buildCreateAtaIx,
  getVaultTokenAccounts,
} from '@/lib/spl'
import { confirmTransactionOrThrow } from '@/lib/transaction-confirmation'
import {
  createInheritanceCommitment,
  createInheritanceSalt,
} from '@/lib/inheritance-commitment'
import { MAX_FUNGIBLE_ASSETS } from '@/lib/fungible-assets'
import {
  classifyCapsuleAccountOwner,
  type CapsuleAccountLocations,
} from '@/lib/capsule-lifecycle'

const DELEGATION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
const PERMISSION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.PERMISSION_PROGRAM_ID)
const MAGIC_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID)
const MAGIC_CONTEXT_ID = new PublicKey(MAGICBLOCK_ER.MAGIC_CONTEXT)
const BUFFER_SEED_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.BUFFER_SEED_PROGRAM_ID)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Default crank cadence mirrors the configured MagicBlock ER schedule interval. */
export const CRANK_DEFAULT_INTERVAL_MS = MAGICBLOCK_ER.CRANK_DEFAULT_INTERVAL_MS
export const CRANK_DEFAULT_ITERATIONS = 100_000

// Re-export connection function
export { getSolanaConnection as getConnection }

/**
 * Read where both lifecycle accounts currently live. Base-layer actions such as distribution,
 * cancellation, and recreation are safe only when both accounts are owned by the Heres program.
 */
export async function getCapsuleAccountLocations(
  owner: PublicKey
): Promise<CapsuleAccountLocations> {
  const [switchPDA] = getCapsulePDA(owner)
  const [beneficiarySetPDA] = getBeneficiarySetPDA(owner)
  const programId = getProgramId().toBase58()
  const delegationProgramId = DELEGATION_PROGRAM_ID.toBase58()

  const read = async (connection: Connection) =>
    connection.getMultipleAccountsInfo([switchPDA, beneficiarySetPDA], 'confirmed')

  let infos
  try {
    infos = await read(getSolanaConnection())
  } catch (primaryError) {
    try {
      infos = await read(getSolanaFallbackConnection())
    } catch {
      throw primaryError
    }
  }

  return {
    switch: classifyCapsuleAccountOwner(
      infos[0]?.owner.toBase58() ?? null,
      programId,
      delegationProgramId
    ),
    beneficiarySet: classifyCapsuleAccountOwner(
      infos[1]?.owner.toBase58() ?? null,
      programId,
      delegationProgramId
    ),
    switchAddress: switchPDA.toBase58(),
    beneficiarySetAddress: beneficiarySetPDA.toBase58(),
  }
}

/**
 * Get Anchor provider (base-layer connection).
 */
export function getProvider(wallet: HeresWallet): AnchorProvider | null {
  if (!wallet.publicKey || !wallet.signTransaction) {
    return null
  }

  const connection = getSolanaConnection()

  const walletAdapter = {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction,
    signAllTransactions: wallet.signAllTransactions || (async (txs: any) => txs),
  } as Wallet

  return new AnchorProvider(connection, walletAdapter, {
    commitment: 'confirmed',
  })
}

/**
 * Get Anchor program instance (base-layer connection).
 */
export function getProgram(wallet: HeresWallet): Program | null {
  const provider = getProvider(wallet)
  if (!provider) return null

  const programId = getProgramId()
  const programIdl = JSON.parse(JSON.stringify(idl))
  programIdl.address = programId.toBase58()

  const program = new Program(programIdl as any, provider)
  return program
}

/**
 * Get Program instance connected to ER RPC (Asia devnet) for delegation & scheduling.
 */
export function getErProgram(wallet: HeresWallet): Program | null {
  if (!wallet.publicKey || !wallet.signTransaction) {
    return null
  }

  const connection = new Connection(MAGICBLOCK_ER.ER_RPC_URL, {
    commitment: 'confirmed',
    wsEndpoint: MAGICBLOCK_ER.ER_WS_URL,
  })

  const walletAdapter = {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction,
    signAllTransactions: wallet.signAllTransactions || (async (txs: any) => txs),
  } as Wallet

  const provider = new AnchorProvider(connection, walletAdapter, {
    commitment: 'confirmed',
  })

  const programId = getProgramId()
  const programIdl = JSON.parse(JSON.stringify(idl))
  programIdl.address = programId.toBase58()

  return new Program(programIdl as any, provider)
}

/**
 * Get Anchor program instance for the TEE / Private ER (authenticated if a token is provided).
 */
export function getTeeProgram(wallet: HeresWallet, token?: string): Program | null {
  if (!wallet.publicKey || !wallet.signTransaction) {
    return null
  }

  const connection = getTeeConnection(token)

  const walletAdapter = {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction,
    signAllTransactions: wallet.signAllTransactions || (async (txs: any) => txs),
  } as Wallet

  const provider = new AnchorProvider(connection, walletAdapter, {
    commitment: 'confirmed',
  })

  const programId = getProgramId()
  const programIdl = JSON.parse(JSON.stringify(idl))
  programIdl.address = programId.toBase58()

  return new Program(programIdl as any, provider)
}

// ---------------------------------------------------------------------------
// send helpers
// ---------------------------------------------------------------------------

/** Sign with the wallet, submit, and confirm on a base-layer connection. */
async function sendBase(
  connection: Connection,
  wallet: HeresWallet,
  instructions: TransactionInstruction[]
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: wallet.publicKey!, blockhash, lastValidBlockHeight })
  instructions.forEach((ix) => tx.add(ix))
  const signed = await wallet.signTransaction!(tx)
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true })
  await confirmTransactionOrThrow(connection, { signature: sig, blockhash, lastValidBlockHeight })
  return sig
}

/**
 * Sign with the wallet, submit, and confirm on the ER by polling signature status. The ER may not
 * simulate the cloned program cleanly (skipPreflight); HTTP status polling avoids WS-subscription
 * token edge cases on a token-authed (TEE) endpoint.
 */
async function sendEr(
  connection: Connection,
  wallet: HeresWallet,
  instructions: TransactionInstruction[]
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: wallet.publicKey!, blockhash, lastValidBlockHeight })
  instructions.forEach((ix) => tx.add(ix))
  const signed = await wallet.signTransaction!(tx)
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true })
  for (let i = 0; i < 25; i++) {
    await sleep(1000)
    const s = (await connection.getSignatureStatuses([sig]))?.value?.[0]
    if (!s) continue
    if (s.err) throw new Error('ER tx err: ' + JSON.stringify(s.err))
    if (['processed', 'confirmed', 'finalized'].includes(s.confirmationStatus ?? '')) return sig
  }
  throw new Error('ER confirm timeout for ' + sig.slice(0, 16))
}

/** True if the base account is currently delegated to the MagicBlock delegation program. */
async function isCapsuleDelegated(capsulePDA: PublicKey): Promise<boolean> {
  return isAccountDelegated(capsulePDA)
}

/** True if an arbitrary base PDA (Switch or BeneficiarySet) is delegated to the delegation program. */
async function isAccountDelegated(pda: PublicKey): Promise<boolean> {
  const info = await getSolanaConnection().getAccountInfo(pda)
  return !!info && info.owner.equals(DELEGATION_PROGRAM_ID)
}

/** Connection to the regular ER (where the Switch is delegated under Workstream A). Token-free. */
function regularErConnection(): Connection {
  return new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
}

// Each on-chain Beneficiary carries a reserved[14] pad (future cross-chain heir field). The Anchor arg
// encoder needs every field, so zero-fill it on write (camelCase keys for the instruction-arg coder).
const toBenArg = (b: OnChainBeneficiary) => ({
  pubkey: b.pubkey,
  shareBps: b.shareBps,
  reserved: b.reserved ?? Array(14).fill(0),
})

const toNftAssignmentArg = (assignment: OnChainNftAssignment) => ({
  mint: assignment.mint,
  recipient: assignment.recipient,
})

/**
 * Sign a batch of base-layer transactions with a SINGLE wallet approval (signAllTransactions), then
 * submit + confirm them strictly in order. Used so the create flow asks the user to approve once even
 * though create / deposit / delegate must execute as distinct on-chain transactions (delegate reads the
 * Switch the prior txs wrote, so they can't all be one instruction list). Falls back to one approval per
 * tx if the wallet lacks signAllTransactions. All txs share one blockhash; the ordered confirms finish
 * well inside its validity window.
 */
async function sendBaseBatch(
  connection: Connection,
  wallet: HeresWallet,
  txGroups: TransactionInstruction[][]
): Promise<string[]> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected')
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const txs = txGroups.map((ixs) => {
    const tx = new Transaction({ feePayer: wallet.publicKey!, blockhash, lastValidBlockHeight })
    ixs.forEach((ix) => tx.add(ix))
    return tx
  })

  let signed: Transaction[]
  if (wallet.signAllTransactions) {
    signed = await wallet.signAllTransactions(txs)
  } else {
    signed = []
    for (const tx of txs) signed.push(await wallet.signTransaction(tx))
  }

  const sigs: string[] = []
  for (const tx of signed) {
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true })
    await confirmTransactionOrThrow(connection, { signature: sig, blockhash, lastValidBlockHeight })
    sigs.push(sig)
  }
  return sigs
}

// ---------------------------------------------------------------------------
// write instructions
// ---------------------------------------------------------------------------

/**
 * Create a new Intent Capsule (Switch + Vault). Beneficiaries are NOT set here (use updateIntent);
 * the vault is NOT funded here (use deposit). heartbeatAuthority is the key allowed to send the
 * liveness heartbeat (update_activity); defaults to the protocol relayer so the off-chain liveness
 * service can bump last_activity (the owner can always bump too via the on-chain is_owner branch).
 */
export async function createCapsule(
  wallet: HeresWallet,
  inactivityPeriodSeconds: number,
  heartbeatAuthority?: PublicKey,
  targetDateSeconds?: number | null
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const owner = wallet.publicKey!
  const [capsulePDA] = getCapsulePDA(owner)
  const [beneficiarySetPDA] = getBeneficiarySetPDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const [feeConfigPDA] = getFeeConfigPDA()

  const platformFeeRecipient = SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT
    ? new PublicKey(SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT)
    : getProgramId() // sentinel when no fee recipient is configured

  const hb = heartbeatAuthority ?? getRelayerPubkey()

  // Retry transient RPC failures (503/blockhash/timeout) with exponential backoff.
  const maxRetries = 5
  let lastError: any
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await program.methods
        .createCapsule(new BN(inactivityPeriodSeconds), hb, targetDateSeconds != null ? new BN(targetDateSeconds) : null)
        .accountsPartial({
          capsule: capsulePDA,
          beneficiarySet: beneficiarySetPDA,
          vault: vaultPDA,
          owner,
          feeConfig: feeConfigPDA,
          platformFeeRecipient,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
    } catch (error: any) {
      lastError = error
      const errorMessage = error?.message || ''
      const isRetryableError =
        errorMessage.includes('503') ||
        errorMessage.includes('Service unavailable') ||
        errorMessage.includes('failed to get recent blockhash') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('network')
      if (isRetryableError && attempt < maxRetries - 1) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 16000)
        debugLog(`RPC error (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`)
        await sleep(delay)
        continue
      }
      throw error
    }
  }
  if (lastError?.message?.includes('503') || lastError?.message?.includes('Service unavailable')) {
    throw new Error('RPC server is temporarily unavailable. Please try again in a few moments.')
  }
  throw lastError
}

export async function registerCapsuleOwnerForAutomation(ownerPubkey: string): Promise<void> {
  const response = await fetch('/api/capsule-registry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner: ownerPubkey }),
  })

  if (response.ok) return

  const raw = await response.text()
  let message = 'Failed to register capsule owner for automation'
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { error?: string }
      message = parsed.error || raw
    } catch {
      message = raw
    }
  }

  throw new Error(`Automation registration failed: ${message}`)
}

/**
 * Set / replace the PRIVATE beneficiary list (Solana pubkeys + share_bps; shares must sum to 10000).
 * Owner-only, and targets the BeneficiarySet - the one enclave-resident account. When that set is
 * delegated to the TEE the write routes there behind the owner's auth token (so the list never touches
 * the base layer); pre-delegation it writes to base. Pass a token, or have one cached for this owner.
 */
export async function updateIntent(
  wallet: HeresWallet,
  beneficiaries: OnChainBeneficiary[],
  token?: string
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const owner = wallet.publicKey!
  const [beneficiarySetPDA] = getBeneficiarySetPDA(owner)

  const ix = await program.methods
    .updateIntent(beneficiaries.map(toBenArg))
    .accountsPartial({ beneficiarySet: beneficiarySetPDA, owner })
    .instruction()

  if (await isAccountDelegated(beneficiarySetPDA)) {
    const teeToken = token ?? getCachedTeeToken(owner) ?? (await getTeeAuthToken(wallet))
    setCachedTeeToken(owner, teeToken)
    return sendEr(getTeeConnection(teeToken), wallet, [ix])
  }
  return sendBase(getSolanaConnection(), wallet, [ix])
}

/**
 * Deposit funds into the vault. SOL deposit when no mint is given; SPL deposit otherwise. The vault
 * is never delegated, so this always runs on the base layer. amount is in lamports (SOL) or the
 * mint's base units (SPL).
 */
export async function deposit(
  wallet: HeresWallet,
  amount: number | BN,
  mint?: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const owner = wallet.publicKey!
  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const amt = amount instanceof BN ? amount : new BN(amount)

  const tokenProgram = mint ? await resolveTokenProgram(getSolanaConnection(), mint) : null
  const accounts: any = mint
    ? {
        capsule: capsulePDA,
        vault: vaultPDA,
        owner,
        systemProgram: SystemProgram.programId,
        tokenProgram,
        associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
        mint,
        sourceTokenAccount: ataFor(mint, owner, tokenProgram!),
        vaultTokenAccount: ataFor(mint, vaultPDA, tokenProgram!),
      }
    : {
        capsule: capsulePDA,
        vault: vaultPDA,
        owner,
        systemProgram: SystemProgram.programId,
        tokenProgram: null,
        associatedTokenProgram: null,
        mint: null,
        sourceTokenAccount: null,
        vaultTokenAccount: null,
      }

  return program.methods.deposit(amt).accountsPartial(accounts).rpc()
}

/**
 * Execute intent once the inactivity period elapses. Permissionless (no owner signature). State-only:
 * flips is_active/executed_at and moves no funds, so it takes exactly 3 accounts. Routes to the ER
 * when the Switch is delegated, otherwise to the base layer.
 */
export async function executeIntent(
  wallet: HeresWallet,
  ownerPublicKey: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(ownerPublicKey)

  const ix = await program.methods
    .executeIntent()
    .accountsPartial({ capsule: capsulePDA })
    .instruction()

  if (await isCapsuleDelegated(capsulePDA)) {
    debugLog('[executeIntent] Switch is delegated, routing through the regular ER RPC')
    return sendEr(regularErConnection(), wallet, [ix])
  }
  return sendBase(getSolanaConnection(), wallet, [ix])
}

/**
 * Delegate ONLY the Switch (capsule) to a regular MagicBlock ER validator. The Switch carries no
 * private data and no PER permission under Workstream A, so this is a plain delegate (11 accounts).
 * The Vault is never delegated; the private BeneficiarySet is delegated separately (delegateBeneficiaries).
 * Runs on the base layer.
 */
export async function delegateCapsule(
  wallet: HeresWallet,
  validatorPubkey?: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const owner = wallet.publicKey
  const [capsulePDA] = getCapsulePDA(owner)
  const programId = getProgramId()
  const validator = validatorPubkey ?? new PublicKey(MAGICBLOCK_ER.ACTIVE_VALIDATOR)
  debugLog('[delegateCapsule] Using validator:', validator.toBase58())

  const connection = getSolanaConnection()
  const accountInfo = await connection.getAccountInfo(capsulePDA)
  if (!accountInfo) throw new Error('Capsule account not found. Please create a capsule first.')
  if (accountInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
    debugLog('Capsule is already delegated to MagicBlock. Proceeding...')
    return 'ALREADY_DELEGATED'
  }
  if (!accountInfo.owner.equals(programId)) {
    throw new Error(`Capsule is not owned by the Heres Program. Current owner: ${accountInfo.owner.toBase58()}`)
  }

  const [bufferPDA] = getBufferPDA(capsulePDA, BUFFER_SEED_PROGRAM_ID)
  const [delegationRecordPDA] = getDelegationRecordPDA(capsulePDA, DELEGATION_PROGRAM_ID)
  const [delegationMetadataPDA] = getDelegationMetadataPDA(capsulePDA, DELEGATION_PROGRAM_ID)

  return program.methods
    .delegateCapsule()
    .accountsPartial({
      payer: owner,
      owner,
      validator,
      bufferPda: bufferPDA,
      delegationRecordPda: delegationRecordPDA,
      delegationMetadataPda: delegationMetadataPDA,
      pda: capsulePDA,
      magicProgram: MAGIC_PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      ownerProgram: programId,
    } as any)
    .rpc()
}

/**
 * Delegate the private BeneficiarySet to the MagicBlock TEE (Private ER), creating + delegating its PER
 * permission alongside (owner-only member). This is the single enclave-resident account. Runs on the
 * base layer. Defaults to the TEE validator. Idempotent: a no-op if already delegated.
 */
export async function delegateBeneficiaries(
  wallet: HeresWallet,
  validatorPubkey?: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const owner = wallet.publicKey
  const programId = getProgramId()
  const [beneficiarySetPDA] = getBeneficiarySetPDA(owner)
  const validator = validatorPubkey ?? new PublicKey(MAGICBLOCK_ER.VALIDATOR_TEE)

  const connection = getSolanaConnection()
  const accountInfo = await connection.getAccountInfo(beneficiarySetPDA)
  if (!accountInfo) throw new Error('BeneficiarySet account not found. Please create a capsule first.')
  if (accountInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
    debugLog('BeneficiarySet is already delegated to the TEE. Proceeding...')
    return 'ALREADY_DELEGATED'
  }

  const [permissionPDA] = getPermissionPDA(beneficiarySetPDA, PERMISSION_PROGRAM_ID)
  const [bufferPDA] = getBufferPDA(beneficiarySetPDA, BUFFER_SEED_PROGRAM_ID)
  const [delegationRecordPDA] = getDelegationRecordPDA(beneficiarySetPDA, DELEGATION_PROGRAM_ID)
  const [delegationMetadataPDA] = getDelegationMetadataPDA(beneficiarySetPDA, DELEGATION_PROGRAM_ID)
  // Delegation PDAs for the permission account itself.
  const [bufferPermission] = getBufferPDA(permissionPDA, PERMISSION_PROGRAM_ID)
  const [delegationRecordPermission] = getDelegationRecordPDA(permissionPDA, DELEGATION_PROGRAM_ID)
  const [delegationMetadataPermission] = getDelegationMetadataPDA(permissionPDA, DELEGATION_PROGRAM_ID)

  return program.methods
    .delegateBeneficiaries()
    .accountsPartial({
      payer: owner,
      owner,
      validator,
      bufferPda: bufferPDA,
      delegationRecordPda: delegationRecordPDA,
      delegationMetadataPda: delegationMetadataPDA,
      pda: beneficiarySetPDA,
      magicProgram: MAGIC_PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      permissionProgram: PERMISSION_PROGRAM_ID,
      permission: permissionPDA,
      bufferPermission,
      delegationRecordPermission,
      delegationMetadataPermission,
      ownerProgram: programId,
    } as any)
    .rpc()
}

/**
 * Schedule the autonomous MagicBlock ScheduleTask crank that fires execute_intent on the ER. Takes 3
 * accounts (magic_program, payer, capsule) - the Switch is on a regular ER with no PER permission, so
 * this runs there, token-free.
 */
export async function scheduleExecuteIntent(
  wallet: HeresWallet,
  ownerPublicKey: PublicKey,
  args?: { taskId?: BN; executionIntervalMillis?: BN; iterations?: BN }
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(ownerPublicKey)

  const taskId = args?.taskId ?? new BN(Date.now())
  const executionIntervalMillis = args?.executionIntervalMillis ?? new BN(MAGICBLOCK_ER.CRANK_DEFAULT_INTERVAL_MS || 60000)
  const iterations = args?.iterations ?? new BN(MAGICBLOCK_ER.CRANK_DEFAULT_ITERATIONS || 0)

  try {
    const ix = await program.methods
      .scheduleExecuteIntent({ taskId, executionIntervalMillis, iterations })
      .accountsPartial({
        magicProgram: MAGIC_PROGRAM_ID,
        payer: wallet.publicKey,
        capsule: capsulePDA,
      })
      .instruction()

    return await sendEr(regularErConnection(), wallet, [ix])
  } catch (err: any) {
    let errorMessage = err.message || 'Unknown error'
    let logs: string[] | null = null
    if (err instanceof SendTransactionError || err.name === 'SendTransactionError') {
      logs = err.logs || null
      if (!logs && typeof err.getLogs === 'function') {
        try {
          logs = await err.getLogs()
        } catch {
          if (err.message && err.message.includes('logs:')) logs = [err.message]
        }
      }
    } else if (err.logs) {
      logs = err.logs
    }
    if (logs) {
      const anchorError = logs.find((l) => l.includes('AnchorError'))
      if (anchorError) {
        errorMessage = `Anchor Error: ${anchorError.split('AnchorError thrown in ')[1] || anchorError}`
      } else if (logs.some((l) => l.includes('invalid instruction data'))) {
        errorMessage = 'Invalid instruction data: The ER may be expecting a different account or argument format.'
      }
    }
    const finalError = new Error(`Crank scheduling failed: ${errorMessage}`)
    // @ts-ignore
    finalError.logs = logs
    throw finalError
  }
}

export type CreateDelegatedCapsuleParams = {
  inactivitySeconds: number
  /** Absolute unix ts (seconds) the switch fires regardless of activity; null/undefined = inactivity-only. */
  targetDateSeconds?: number | null
  beneficiaries: OnChainBeneficiary[]
  /** Vault funding amount in lamports (SOL) or the mint's base units (SPL). */
  depositBaseUnits?: number | BN
  /** SPL mint, or null/undefined for native SOL. */
  mint?: PublicKey | null
  /** Multiple fungible deposits. Each mint (including native SOL as null) may appear only once. */
  fungibleDeposits?: Array<{
    amountBaseUnits: number | BN
    mint?: PublicKey | null
  }>
  /** Standard SPL NFTs to lock, each with one explicit recipient. Mutually exclusive with mint/SOL. */
  nftAssignments?: OnChainNftAssignment[]
  /** Liveness heartbeat authority; defaults to the protocol relayer (off-chain liveness service). */
  heartbeatAuthority?: PublicKey
  /** Override the delegation validator; defaults to the TEE node (VALIDATOR_TEE). */
  validator?: PublicKey
  /** Autonomous ScheduleTask cadence overrides. */
  schedule?: { taskId?: BN; executionIntervalMillis?: BN; iterations?: BN }
  /** UI progress callback. */
  onStep?: (label: string) => void
}

/**
 * The single, intended capsule-creation flow (Workstream A):
 *   - create the Switch + BeneficiarySet + Vault, fund the Vault;
 *   - delegate the Switch to a REGULAR ER (token-free liveness) and the BeneficiarySet to the TEE
 *     (the one enclave-resident account, behind a PER permission);
 *   - schedule the autonomous execute_intent crank on the regular-ER Switch;
 *   - set the PRIVATE beneficiary list inside the TEE.
 * Beneficiaries NEVER touch the base layer - they are written only inside the TEE. There is no base-only fork.
 *
 * Wallet interactions: one base-bundle approval (create+deposit, delegate Switch, delegate set), one
 * regular-ER approval (schedule, token-free), one auth-token signature, one TEE approval (private
 * beneficiaries). Delegations must run as distinct txs (each reads state a prior tx wrote).
 */
export async function createDelegatedCapsule(
  wallet: HeresWallet,
  params: CreateDelegatedCapsuleParams
): Promise<{ baseSigs: string[]; teeSig: string; scheduleSig: string; capsule: PublicKey; token: string }> {
  const program = getProgram(wallet)
  if (!program || !wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected')

  const owner = wallet.publicKey
  const programId = getProgramId()
  const [capsulePDA] = getCapsulePDA(owner)
  const [beneficiarySetPDA] = getBeneficiarySetPDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const [feeConfigPDA] = getFeeConfigPDA()
  const [permissionPDA] = getPermissionPDA(beneficiarySetPDA, PERMISSION_PROGRAM_ID)

  const hb = params.heartbeatAuthority ?? getRelayerPubkey()
  const erValidator = new PublicKey(MAGICBLOCK_ER.ACTIVE_VALIDATOR) // regular ER for the Switch
  const teeValidator = params.validator ?? new PublicKey(MAGICBLOCK_ER.VALIDATOR_TEE) // TEE for the set
  const nftAssignments = params.nftAssignments ?? []
  const legacyFungibleDeposit = params.depositBaseUnits == null
    ? []
    : [{ amountBaseUnits: params.depositBaseUnits, mint: params.mint ?? null }]
  const fungibleDeposits = params.fungibleDeposits ?? legacyFungibleDeposit
  if (nftAssignments.length > 0 && fungibleDeposits.length > 0) {
    throw new Error('NFT funding cannot be combined with a fungible deposit during capsule creation')
  }
  if (params.fungibleDeposits && params.depositBaseUnits != null) {
    throw new Error('Use fungibleDeposits or the legacy deposit fields, not both')
  }
  if (fungibleDeposits.length > MAX_FUNGIBLE_ASSETS) {
    throw new Error(`No more than ${MAX_FUNGIBLE_ASSETS} fungible assets can be funded at creation`)
  }
  const fungibleKeys = fungibleDeposits.map((deposit) => deposit.mint?.toBase58() ?? 'sol')
  if (new Set(fungibleKeys).size !== fungibleKeys.length) {
    throw new Error('Each fungible asset can be deposited only once during capsule creation')
  }

  const platformFeeRecipient = SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT
    ? new PublicKey(SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT)
    : programId // sentinel when no fee recipient is configured

  // ---- base ix 1: create the Switch + BeneficiarySet + Vault ----
  const targetDateBN = params.targetDateSeconds != null ? new BN(params.targetDateSeconds) : null
  const createIx = await program.methods
    .createCapsule(new BN(params.inactivitySeconds), hb, targetDateBN)
    .accountsPartial({
      capsule: capsulePDA,
      beneficiarySet: beneficiarySetPDA,
      vault: vaultPDA,
      owner,
      feeConfig: feeConfigPDA,
      platformFeeRecipient,
      systemProgram: SystemProgram.programId,
    })
    .instruction()

  // ---- base ix 2+: deposit assets (Vault is never delegated) ----
  const baseConnection = getSolanaConnection()
  const depositIxs: TransactionInstruction[] = []
  if (nftAssignments.length > 0) {
    for (const assignment of nftAssignments) {
      const tokenProgram = await validateStandardNft(baseConnection, owner, assignment.mint)
      depositIxs.push(
        await program.methods
          .deposit(new BN(1))
          .accountsPartial({
            capsule: capsulePDA,
            vault: vaultPDA,
            owner,
            systemProgram: SystemProgram.programId,
            tokenProgram,
            associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
            mint: assignment.mint,
            sourceTokenAccount: ataFor(assignment.mint, owner, tokenProgram),
            vaultTokenAccount: ataFor(assignment.mint, vaultPDA, tokenProgram),
          })
          .instruction()
      )
    }
  } else {
    if (fungibleDeposits.length === 0) throw new Error('At least one deposit amount is required')
    for (const deposit of fungibleDeposits) {
      const mint = deposit.mint ?? null
      const amt = deposit.amountBaseUnits instanceof BN
        ? deposit.amountBaseUnits
        : new BN(deposit.amountBaseUnits)
      if (amt.lte(new BN(0))) throw new Error('Deposit amounts must be greater than zero')
      const depositTokenProgram = mint ? await resolveTokenProgram(baseConnection, mint) : null
      const depositAccounts: any = mint
        ? {
            capsule: capsulePDA,
            vault: vaultPDA,
            owner,
            systemProgram: SystemProgram.programId,
            tokenProgram: depositTokenProgram,
            associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
            mint,
            sourceTokenAccount: ataFor(mint, owner, depositTokenProgram!),
            vaultTokenAccount: ataFor(mint, vaultPDA, depositTokenProgram!),
          }
        : {
            capsule: capsulePDA,
            vault: vaultPDA,
            owner,
            systemProgram: SystemProgram.programId,
            tokenProgram: null,
            associatedTokenProgram: null,
            mint: null,
            sourceTokenAccount: null,
            vaultTokenAccount: null,
          }
      depositIxs.push(await program.methods.deposit(amt).accountsPartial(depositAccounts).instruction())
    }
  }

  // ---- base ix 3: delegate the Switch to the regular ER (no permission, 11 accounts) ----
  const [swBufferPDA] = getBufferPDA(capsulePDA, BUFFER_SEED_PROGRAM_ID)
  const [swRecordPDA] = getDelegationRecordPDA(capsulePDA, DELEGATION_PROGRAM_ID)
  const [swMetaPDA] = getDelegationMetadataPDA(capsulePDA, DELEGATION_PROGRAM_ID)
  const delegateSwitchIx = await program.methods
    .delegateCapsule()
    .accountsPartial({
      payer: owner,
      owner,
      validator: erValidator,
      bufferPda: swBufferPDA,
      delegationRecordPda: swRecordPDA,
      delegationMetadataPda: swMetaPDA,
      pda: capsulePDA,
      magicProgram: MAGIC_PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      ownerProgram: programId,
    } as any)
    .instruction()

  // ---- base ix 4: delegate the BeneficiarySet (+ PER permission) to the TEE (16 accounts) ----
  const [bsBufferPDA] = getBufferPDA(beneficiarySetPDA, BUFFER_SEED_PROGRAM_ID)
  const [bsRecordPDA] = getDelegationRecordPDA(beneficiarySetPDA, DELEGATION_PROGRAM_ID)
  const [bsMetaPDA] = getDelegationMetadataPDA(beneficiarySetPDA, DELEGATION_PROGRAM_ID)
  const [bufferPermission] = getBufferPDA(permissionPDA, PERMISSION_PROGRAM_ID)
  const [delegationRecordPermission] = getDelegationRecordPDA(permissionPDA, DELEGATION_PROGRAM_ID)
  const [delegationMetadataPermission] = getDelegationMetadataPDA(permissionPDA, DELEGATION_PROGRAM_ID)
  const delegateBenIx = await program.methods
    .delegateBeneficiaries()
    .accountsPartial({
      payer: owner,
      owner,
      validator: teeValidator,
      bufferPda: bsBufferPDA,
      delegationRecordPda: bsRecordPDA,
      delegationMetadataPda: bsMetaPDA,
      pda: beneficiarySetPDA,
      magicProgram: MAGIC_PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      permissionProgram: PERMISSION_PROGRAM_ID,
      permission: permissionPDA,
      bufferPermission,
      delegationRecordPermission,
      delegationMetadataPermission,
      ownerProgram: programId,
    } as any)
    .instruction()

  // One wallet approval for the whole base setup. Each delegate carries a CU bump: the create +
  // permission/delegation CPIs exceed the 200k default.
  params.onStep?.(
    depositIxs.length > 1
      ? `Creating capsule and funding ${depositIxs.length} assets...`
      : 'Creating, funding & delegating capsule...'
  )
  const baseConn = getSolanaConnection()
  const baseSigs = await sendBaseBatch(baseConn, wallet, [
    [createIx],
    ...depositIxs.map((ix) => [ix]),
    [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), delegateSwitchIx],
    [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), delegateBenIx],
  ])

  // Wait for BOTH base accounts to flip to the delegation program.
  params.onStep?.('Waiting for delegations...')
  for (let i = 0; i < 16; i++) {
    if ((await isAccountDelegated(capsulePDA)) && (await isAccountDelegated(beneficiarySetPDA))) break
    await sleep(2500)
  }

  // ---- TEE: atomically write and seal the PRIVATE settlement configuration ----
  // Mint the per-key TEE auth token (signMessage). Cache it so the immediate post-create read can show
  // live private state without re-prompting.
  params.onStep?.('Authorizing TEE access...')
  const token = await getTeeAuthToken(wallet)
  setCachedTeeToken(owner, token)
  const teeConn = getTeeConnection(token)

  // Wait for the BeneficiarySet to clone onto the TEE node.
  params.onStep?.('Waiting for TEE sync...')
  for (let i = 0; i < 16; i++) {
    const info = await teeConn.getAccountInfo(beneficiarySetPDA).catch(() => null)
    if (info) break
    await sleep(2500)
  }
  const updateIntentIx = await program.methods
    .updateIntent(params.beneficiaries.map(toBenArg))
    .accountsPartial({ beneficiarySet: beneficiarySetPDA, owner })
    .instruction()
  const teeIxs = [updateIntentIx]
  if (nftAssignments.length > 0) {
    teeIxs.push(
      await program.methods
        .updateNftAssignments(nftAssignments.map(toNftAssignmentArg))
        .accountsPartial({ beneficiarySet: beneficiarySetPDA, owner })
        .instruction()
    )
  }
  const configSalt = createInheritanceSalt()
  const configCommitment = await createInheritanceCommitment(
    owner,
    params.beneficiaries,
    nftAssignments,
    configSalt
  )
  teeIxs.push(
    await program.methods
      .sealInheritance(Array.from(configSalt), Array.from(configCommitment))
      .accountsPartial({ beneficiarySet: beneficiarySetPDA, owner })
      .instruction()
  )
  params.onStep?.(
    nftAssignments.length > 0
      ? 'Setting and sealing private NFT recipients...'
      : 'Setting and sealing private beneficiaries...'
  )
  const teeSig = await sendEr(teeConn, wallet, teeIxs)

  // ---- regular ER: arm the sealed Switch and schedule execution in one transaction ----
  params.onStep?.('Waiting for ER sync...')
  const erConn = regularErConnection()
  for (let i = 0; i < 16; i++) {
    const info = await erConn.getAccountInfo(capsulePDA).catch(() => null)
    if (info) break
    await sleep(2500)
  }
  const armIx = await program.methods
    .armCapsule(Array.from(configCommitment))
    .accountsPartial({ capsule: capsulePDA, owner })
    .instruction()
  const taskId = params.schedule?.taskId ?? new BN(Date.now())
  const executionIntervalMillis =
    params.schedule?.executionIntervalMillis ?? new BN(MAGICBLOCK_ER.CRANK_DEFAULT_INTERVAL_MS || 10000)
  const iterations = params.schedule?.iterations ?? new BN(MAGICBLOCK_ER.CRANK_DEFAULT_ITERATIONS || 100_000)
  const scheduleIx = await program.methods
    .scheduleExecuteIntent({ taskId, executionIntervalMillis, iterations })
    .accountsPartial({ magicProgram: MAGIC_PROGRAM_ID, payer: owner, capsule: capsulePDA })
    .instruction()
  params.onStep?.('Arming capsule and scheduling autonomous crank...')
  const scheduleSig = await sendEr(erConn, wallet, [armIx, scheduleIx])

  return { baseSigs, teeSig, scheduleSig, capsule: capsulePDA, token }
}

/**
 * Distribute every vault asset to the on-chain beneficiaries, split by share_bps. SPL legs run first
 * (each closes the vault ATA, returning its rent to the vault); the SOL leg runs last so it sweeps
 * the reclaimed rent too. Must run on the base layer (the Switch undelegated). Returns the last tx sig.
 */
export async function distributeAssets(
  wallet: HeresWallet,
  ownerPublicKey: PublicKey,
  beneficiaries: OnChainBeneficiary[],
  nftAssignments: OnChainNftAssignment[] = [],
  onLegConfirmed?: (progress: { completed: number; signature: string; asset: string }) => void
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected')
  if (!beneficiaries.length && !nftAssignments.length) {
    throw new Error('Capsule has no inheritance recipients')
  }

  const [capsulePDA] = getCapsulePDA(ownerPublicKey)
  const [beneficiarySetPDA] = getBeneficiarySetPDA(ownerPublicKey)
  const [vaultPDA] = getCapsuleVaultPDA(ownerPublicKey)
  const connection = getSolanaConnection()

  if (await isCapsuleDelegated(capsulePDA)) {
    throw new Error('Switch is still delegated to ER. Please undelegate first before distributing assets.')
  }
  if (await isAccountDelegated(beneficiarySetPDA)) {
    throw new Error('Beneficiary list is still in the TEE. Reveal it (undelegate) first before distributing.')
  }

  let lastSig = ''
  let completedLegs = 0

  // 1. SPL legs first - scan BOTH token programs (classic SPL + Token-2022).
  const vaultTokens = await getVaultTokenAccounts(connection, vaultPDA)
  for (const { ata: vaultAta, mint, amount, decimals, tokenProgram } of vaultTokens) {
    if (amount === 0n) continue

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
          buildCreateAtaIx(wallet.publicKey, recipientAta, assignment.recipient, mint, tokenProgram)
        )
      }
      const ix = await program.methods
        .distributeNft(assignment.recipient)
        .accountsPartial({
          capsule: capsulePDA,
          beneficiarySet: beneficiarySetPDA,
          vault: vaultPDA,
          tokenProgram,
          mint,
          vaultTokenAccount: vaultAta,
          recipientTokenAccount: recipientAta,
        })
        .instruction()
      lastSig = await sendBase(connection, wallet, [...preIxs, ix])
      completedLegs += 1
      onLegConfirmed?.({ completed: completedLegs, signature: lastSig, asset: mint.toBase58() })
      continue
    }

    const preIxs: TransactionInstruction[] = []
    const remaining = [] as { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
    for (const b of beneficiaries) {
      const bAta = ataFor(mint, b.pubkey, tokenProgram)
      const exists = await connection.getAccountInfo(bAta)
      if (!exists) preIxs.push(buildCreateAtaIx(wallet.publicKey, bAta, b.pubkey, mint, tokenProgram))
      remaining.push({ pubkey: bAta, isSigner: false, isWritable: true })
    }

    const ix = await program.methods
      .distributeAssets()
      .accountsPartial({
        capsule: capsulePDA,
        beneficiarySet: beneficiarySetPDA,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram,
        mint,
        vaultTokenAccount: vaultAta,
      })
      .remainingAccounts(remaining)
      .instruction()
    lastSig = await sendBase(connection, wallet, [...preIxs, ix])
    completedLegs += 1
    onLegConfirmed?.({ completed: completedLegs, signature: lastSig, asset: mint.toBase58() })
  }

  // 2. SOL leg last (sweeps lamports incl. reclaimed ATA rent).
  const vaultInfo = await connection.getAccountInfo(vaultPDA)
  if (vaultInfo) {
    const rentFloor = await connection.getMinimumBalanceForRentExemption(vaultInfo.data.length)
    if (vaultInfo.lamports > rentFloor) {
      const remaining = beneficiaries.map((b) => ({ pubkey: b.pubkey, isSigner: false, isWritable: true }))
      const ix = await program.methods
        .distributeAssets()
        // null optional accounts -> Anchor encodes the program-id None sentinel; the generated TS type
        // omits null, so cast (the IDL is already loaded untyped).
        .accountsPartial({
          capsule: capsulePDA,
          beneficiarySet: beneficiarySetPDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: null,
          mint: null,
          vaultTokenAccount: null,
        } as any)
        .remainingAccounts(remaining)
        .instruction()
      lastSig = await sendBase(connection, wallet, [ix])
      completedLegs += 1
      onLegConfirmed?.({ completed: completedLegs, signature: lastSig, asset: 'SOL' })
    }
  }

  if (!lastSig) throw new Error('Nothing to distribute (vault already drained)')
  return lastSig
}

/**
 * Initialize platform fee config (call once after program deploy; authority can update via updateFeeConfig).
 */
export async function initFeeConfig(
  wallet: HeresWallet,
  feeRecipient: PublicKey,
  creationFeeLamports: number = PLATFORM_FEE.CREATION_FEE_LAMPORTS
): Promise<string> {
  if (creationFeeLamports > 1_000_000_000) throw new Error('creationFeeLamports must be <= 1 SOL')
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  const [feeConfigPDA] = getFeeConfigPDA()
  return program.methods
    .initFeeConfig(feeRecipient, new BN(creationFeeLamports))
    .accountsPartial({
      feeConfig: feeConfigPDA,
      authority: wallet.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc()
}

/**
 * Update platform fee config (authority only).
 */
export async function updateFeeConfig(
  wallet: HeresWallet,
  creationFeeLamports: number
): Promise<string> {
  if (creationFeeLamports > 1_000_000_000) throw new Error('creationFeeLamports must be <= 1 SOL')
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  const [feeConfigPDA] = getFeeConfigPDA()
  return program.methods
    .updateFeeConfig(new BN(creationFeeLamports))
    .accountsPartial({
      feeConfig: feeConfigPDA,
      authority: wallet.publicKey!,
    })
    .rpc()
}

/**
 * Send the liveness heartbeat (update_activity) as the capsule's heartbeat_authority.
 */
export async function updateActivity(wallet: HeresWallet, ownerPublicKey?: PublicKey): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(ownerPublicKey ?? wallet.publicKey!)

  const ix = await program.methods
    .updateActivity()
    .accountsPartial({ capsule: capsulePDA, authority: wallet.publicKey! })
    .instruction()

  if (await isCapsuleDelegated(capsulePDA)) {
    const erConnection = new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
    return sendEr(erConnection, wallet, [ix])
  }
  return sendBase(getSolanaConnection(), wallet, [ix])
}

/** Close a fully settled capsule and send its account rent to FeeConfig.fee_recipient. */
export async function finalizeCapsule(wallet: HeresWallet, ownerPublicKey?: PublicKey): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const owner = ownerPublicKey ?? wallet.publicKey!
  const [capsulePDA] = getCapsulePDA(owner)
  const [beneficiarySetPDA] = getBeneficiarySetPDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const [feeConfigPDA] = getFeeConfigPDA()
  const feeConfig = await (program.account as any).feeConfig.fetch(feeConfigPDA)
  const feeRecipientRaw = feeConfig.feeRecipient ?? feeConfig.fee_recipient
  if (!feeRecipientRaw) throw new Error('Protocol fee recipient is not configured')
  const feeRecipient = new PublicKey(feeRecipientRaw)

  const ix = await program.methods
    .finalizeCapsule()
    .accountsPartial({
      capsule: capsulePDA,
      beneficiarySet: beneficiarySetPDA,
      vault: vaultPDA,
      authority: wallet.publicKey!,
      feeConfig: feeConfigPDA,
      feeRecipient,
    })
    .instruction()

  return sendBase(getSolanaConnection(), wallet, [ix])
}

/**
 * Decode the live LIVENESS of a DELEGATED Switch. The base account is a delegation stub; under
 * Workstream A the Switch is delegated to a REGULAR ER (never the TEE), so its real state is read
 * token-free from the ER. Beneficiaries are NOT here - they live in the BeneficiarySet (see
 * readBeneficiaries). Returns null if the ER read yields no decodable data.
 */
async function decodeDelegatedCapsule(
  capsulePDA: PublicKey,
  baseInfo: { data: Buffer | Uint8Array; owner: PublicKey }
): Promise<IntentCapsule | null> {
  try {
    const info = await regularErConnection().getAccountInfo(capsulePDA)
    if (info?.data) {
      const capsule = tryDecodeIntentCapsule(Buffer.from(info.data))
      if (capsule) {
        capsule.accountOwner = baseInfo.owner
        return capsule
      }
    }
  } catch {
    /* fall through to null */
  }
  return null
}

/**
 * Read the private beneficiary list for an owner from the BeneficiarySet. When delegated to the TEE,
 * reads the enclave copy behind the owner's auth token (the read is FILTERED to [] without a valid
 * token - the privacy guarantee). Pre-delegation or post-reveal, reads the base account directly.
 * Never throws (returns [] on any failure / filtered read).
 */
async function readPrivateInheritance(
  owner: PublicKey,
  token?: string
): Promise<{
  beneficiaries: OnChainBeneficiary[]
  nftAssignments: OnChainNftAssignment[]
  version?: number
  isSealed: boolean
  isDelegated: boolean
}> {
  const empty = {
    beneficiaries: [],
    nftAssignments: [],
    version: undefined,
    isSealed: false,
    isDelegated: false,
  }
  const [benSetPDA] = getBeneficiarySetPDA(owner)
  try {
    const baseInfo = await getSolanaConnection().getAccountInfo(benSetPDA)
    if (!baseInfo) return empty

    if (baseInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
      // Delegated to the TEE: read the enclave copy. A valid token unlocks the list; without one the
      // Query Filtering Service returns a stub that won't decode -> [].
      const authToken = token ?? getCachedTeeToken(owner)
      const candidates: Buffer[] = []
      const tryRead = async (conn: Connection) => {
        try {
          const i = await conn.getAccountInfo(benSetPDA)
          if (i?.data) candidates.push(Buffer.from(i.data))
        } catch {
          /* try the next candidate */
        }
      }
      if (authToken) await tryRead(getTeeConnection(authToken))
      for (const buf of candidates) {
        const decoded = tryDecodeBeneficiarySetData(buf)
        if (decoded) return { ...decoded, isDelegated: true }
      }
      return { ...empty, isDelegated: true }
    }

    // Base-resident (pre-delegation or post-reveal): decode directly.
    const decoded = tryDecodeBeneficiarySetData(Buffer.from(baseInfo.data))
    return decoded ? { ...decoded, isDelegated: false } : empty
  } catch {
    return empty
  }
}

/**
 * Fetch capsule data for an owner (lean decode). When the Switch is delegated, reads the live copy from
 * the TEE (or regular ER for legacy delegations). Pass an auth token - or have one cached for this owner
 * (see lib/tee) - to read the PRIVATE beneficiary list; otherwise only non-private fields come back.
 */
export async function getCapsule(owner: PublicKey, token?: string): Promise<IntentCapsule | null> {
  const connection = getSolanaConnection()
  const fallbackConnection = getSolanaFallbackConnection()
  const [capsulePDA] = getCapsulePDA(owner)

  try {
    const maxRetries = 3
    let accountInfo = null
    let lastError: any

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        accountInfo = await connection.getAccountInfo(capsulePDA)
        break
      } catch (error: any) {
        lastError = error
        const errorMessage = error?.message || ''
        const isRetryableError =
          errorMessage.includes('429') ||
          errorMessage.includes('Too Many Requests') ||
          errorMessage.includes('rate limit') ||
          errorMessage.includes('Rate limit') ||
          errorMessage.includes('Connection rate limits exceeded') ||
          errorMessage.includes('503') ||
          errorMessage.includes('401') ||
          errorMessage.includes('32401') ||
          errorMessage.includes('Bad request') ||
          errorMessage.includes('Service unavailable') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('network') ||
          errorMessage.includes('Unauthorized')
        if (isRetryableError && attempt < maxRetries - 1) {
          const delay = Math.min(2000 * Math.pow(2, attempt), 10000)
          await sleep(delay)
          continue
        }
        throw error
      }
    }

    if (!accountInfo && lastError) {
      try {
        accountInfo = await fallbackConnection.getAccountInfo(capsulePDA)
      } catch (fallbackError: any) {
        debugLog('Fallback capsule fetch also failed:', fallbackError?.message || fallbackError)
      }
    }

    if (!accountInfo || !accountInfo.data) return null

    // Liveness: delegated Switch -> read the live copy from the regular ER (token-free); else base.
    const capsule = accountInfo.owner.equals(DELEGATION_PROGRAM_ID)
      ? await decodeDelegatedCapsule(capsulePDA, accountInfo)
      : (() => {
          const c = decodeIntentCapsule(accountInfo.data)
          c.accountOwner = accountInfo.owner
          return c
        })()
    if (!capsule) return null

    // Beneficiaries live in the separate BeneficiarySet (TEE w/ token, or base post-reveal).
    const inheritance = await readPrivateInheritance(owner, token ?? getCachedTeeToken(owner))
    capsule.beneficiaries = inheritance.beneficiaries
    capsule.nftAssignments = inheritance.nftAssignments
    capsule.inheritanceSealed = inheritance.isSealed
    capsule.inheritanceDelegated = inheritance.isDelegated
    return capsule
  } catch (error) {
    console.error('Error fetching capsule:', error, 'owner:', owner.toString())
    throw error
  }
}

/**
 * Fetch a capsule by its PDA (capsule account address). Used on the capsule detail page.
 */
export async function getCapsuleByAddress(
  capsulePda: PublicKey,
  token?: string
): Promise<(IntentCapsule & { capsuleAddress: string }) | null> {
  const connection = getSolanaConnection()
  try {
    const accountInfo = await connection.getAccountInfo(capsulePda)
    if (!accountInfo || !accountInfo.data) return null

    // Liveness: delegated Switch -> read the live copy from the regular ER (token-free); else base.
    const capsule = accountInfo.owner.equals(DELEGATION_PROGRAM_ID)
      ? await decodeDelegatedCapsule(capsulePda, accountInfo)
      : (() => {
          const c = decodeIntentCapsule(accountInfo.data)
          c.accountOwner = accountInfo.owner
          return c
        })()

    if (!capsule) return null
    // Beneficiaries live in the separate BeneficiarySet (TEE w/ token, or base post-reveal).
    const inheritance = await readPrivateInheritance(
      capsule.owner,
      token ?? getCachedTeeToken(capsule.owner)
    )
    capsule.beneficiaries = inheritance.beneficiaries
    capsule.nftAssignments = inheritance.nftAssignments
    capsule.inheritanceSealed = inheritance.isSealed
    capsule.inheritanceDelegated = inheritance.isDelegated
    return { ...capsule, capsuleAddress: capsulePda.toBase58() }
  } catch (error) {
    console.error('Error fetching capsule by address:', error, 'capsule:', capsulePda.toBase58())
    throw error
  }
}

/**
 * Owner escape hatch: bring BOTH the Switch and the private BeneficiarySet back to the base layer.
 * Two steps in sequence (each gated on-chain to owner-or-fired):
 *   1. crank_undelegate (Switch, regular ER, 5 accounts, token-free), then
 *   2. crank_undelegate_beneficiaries (BeneficiarySet, TEE, 8 accounts) - the privacy reveal, which
 *      needs the owner's auth token and the Switch already back on base (step 1).
 * Each step is skipped if that account is already on base. Waits for the base account to be
 * program-owned again after each step.
 */
export async function undelegateCapsule(
  wallet: HeresWallet,
  ownerPublicKey?: PublicKey,
  token?: string
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected')

  const ownerKey = ownerPublicKey ?? wallet.publicKey
  const [capsulePDA] = getCapsulePDA(ownerKey)
  const [beneficiarySetPDA] = getBeneficiarySetPDA(ownerKey)
  const programId = getProgramId()
  const baseConnection = getSolanaConnection()

  const waitForBaseProgramOwner = async (account: PublicKey, timeoutMs = 20_000): Promise<boolean> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const info = await baseConnection.getAccountInfo(account)
      if (info?.owner.equals(programId)) return true
      await sleep(2_000)
    }
    return false
  }

  let lastSig = ''

  // ---- Step 1: undelegate the Switch from the regular ER ----
  if (await isAccountDelegated(capsulePDA)) {
    const ix = await program.methods
      .crankUndelegate()
      .accountsPartial({
        payer: wallet.publicKey,
        owner: ownerKey,
        capsule: capsulePDA,
        magicContext: MAGIC_CONTEXT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .instruction()
    lastSig = await sendEr(regularErConnection(), wallet, [ix])
    if (!(await waitForBaseProgramOwner(capsulePDA))) {
      throw new Error('Switch undelegation submitted but not yet visible on base layer')
    }
  }

  // ---- Step 2: reveal the BeneficiarySet from the TEE (needs the owner's auth token) ----
  if (await isAccountDelegated(beneficiarySetPDA)) {
    const teeToken = token ?? getCachedTeeToken(ownerKey) ?? (await getTeeAuthToken(wallet))
    setCachedTeeToken(ownerKey, teeToken)
    const [permissionPDA] = getPermissionPDA(beneficiarySetPDA, PERMISSION_PROGRAM_ID)
    const ix = await program.methods
      .crankUndelegateBeneficiaries()
      .accountsPartial({
        payer: wallet.publicKey,
        owner: ownerKey,
        beneficiarySet: beneficiarySetPDA,
        switch: capsulePDA,
        permission: permissionPDA,
        permissionProgram: PERMISSION_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .instruction()
    lastSig = await sendEr(getTeeConnection(teeToken), wallet, [ix])
    if (!(await waitForBaseProgramOwner(beneficiarySetPDA))) {
      throw new Error('Beneficiary reveal submitted but not yet visible on base layer')
    }
  }

  if (!lastSig) throw new Error('Nothing to undelegate (Switch and BeneficiarySet already on base)')
  debugLog('[undelegateCapsule] Success. Tx:', lastSig)
  return lastSig
}

/**
 * Finalize an undelegation on the base layer after the ER committed the account.
 */
export async function processUndelegation(
  wallet: HeresWallet,
  baseAccount: PublicKey,
  accountSeeds: Uint8Array[]
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const [bufferPDA] = getBufferPDA(baseAccount, BUFFER_SEED_PROGRAM_ID)
  const seedsBuffers = accountSeeds.map((s) => Buffer.from(s))

  return program.methods
    .processUndelegation(seedsBuffers)
    .accountsPartial({
      baseAccount,
      buffer: bufferPDA,
      payer: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc()
}

/**
 * Owner escape hatch: pull all funds out of the vault (works even while the Switch is delegated, since
 * the vault is never delegated). SOL when no mint; SPL otherwise.
 */
export async function recoverVault(
  wallet: HeresWallet,
  ownerPublicKey?: PublicKey,
  mint?: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const owner = ownerPublicKey ?? wallet.publicKey
  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)

  const connection = getSolanaConnection()
  const tokenProgram = mint ? await resolveTokenProgram(connection, mint) : null
  const ownerTokenAccount = mint ? ataFor(mint, owner, tokenProgram!) : null
  const preInstructions = mint && ownerTokenAccount && !(await connection.getAccountInfo(ownerTokenAccount))
    ? [buildCreateAtaIx(wallet.publicKey, ownerTokenAccount, owner, mint, tokenProgram!)]
    : []
  const accounts: any = mint
    ? {
        capsule: capsulePDA,
        vault: vaultPDA,
        owner,
        systemProgram: SystemProgram.programId,
        tokenProgram,
        mint,
        vaultTokenAccount: ataFor(mint, vaultPDA, tokenProgram!),
        ownerTokenAccount,
      }
    : {
        capsule: capsulePDA,
        vault: vaultPDA,
        owner,
        systemProgram: SystemProgram.programId,
        tokenProgram: null,
        mint: null,
        vaultTokenAccount: null,
        ownerTokenAccount: null,
      }

  return program.methods.recoverVault().accountsPartial(accounts).preInstructions(preInstructions).rpc()
}

/**
 * Cancel (close) a capsule, reclaiming SOL from the vault and account rent. Owner-only. SPL capsules
 * need the token-refund accounts; SOL capsules leave them null.
 */
export async function cancelCapsule(wallet: HeresWallet, mint?: PublicKey): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const owner = wallet.publicKey
  const [capsulePDA] = getCapsulePDA(owner)
  const [beneficiarySetPDA] = getBeneficiarySetPDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)

  const connection = getSolanaConnection()
  const tokenProgram = mint ? await resolveTokenProgram(connection, mint) : null
  const ownerTokenAccount = mint ? ataFor(mint, owner, tokenProgram!) : null
  const preInstructions = mint && ownerTokenAccount && !(await connection.getAccountInfo(ownerTokenAccount))
    ? [buildCreateAtaIx(wallet.publicKey, ownerTokenAccount, owner, mint, tokenProgram!)]
    : []
  const accounts: any = mint
    ? {
        capsule: capsulePDA,
        beneficiarySet: beneficiarySetPDA,
        vault: vaultPDA,
        owner,
        systemProgram: SystemProgram.programId,
        tokenProgram,
        mint,
        vaultTokenAccount: ataFor(mint, vaultPDA, tokenProgram!),
        ownerTokenAccount,
      }
    : {
        capsule: capsulePDA,
        beneficiarySet: beneficiarySetPDA,
        vault: vaultPDA,
        owner,
        systemProgram: SystemProgram.programId,
        tokenProgram: null,
        mint: null,
        vaultTokenAccount: null,
        ownerTokenAccount: null,
      }

  return program.methods.cancelCapsule().accountsPartial(accounts).preInstructions(preInstructions).rpc()
}

// Re-export types
export type { IntentCapsule } from '@/types'

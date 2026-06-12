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
import { WalletContextState } from '@solana/wallet-adapter-react'
import idl from '../idl/heres_program.json'
import { getSolanaConnection, getSolanaFallbackConnection, getTeeConnection, getProgramId } from '@/config/solana'
import {
  getCapsulePDA,
  getFeeConfigPDA,
  getCapsuleVaultPDA,
  getBufferPDA,
  getDelegationRecordPDA,
  getDelegationMetadataPDA,
  getPermissionPDA,
} from './program'
import { SOLANA_CONFIG, PLATFORM_FEE, MAGICBLOCK_ER } from '@/constants'
import { debugLog } from '@/lib/log'
import { decodeIntentCapsule, tryDecodeIntentCapsule } from '@/lib/lean-capsule'
import { getTeeAuthToken, getCachedTeeToken, setCachedTeeToken } from '@/lib/tee'
import type { IntentCapsule, OnChainBeneficiary } from '@/types'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

const DELEGATION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
const PERMISSION_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.PERMISSION_PROGRAM_ID)
const MAGIC_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID)
const MAGIC_CONTEXT_ID = new PublicKey(MAGICBLOCK_ER.MAGIC_CONTEXT)
const BUFFER_SEED_PROGRAM_ID = new PublicKey(MAGICBLOCK_ER.BUFFER_SEED_PROGRAM_ID)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
  )[0]
}

function buildCreateAssociatedTokenAccountInstruction(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  })
}

/** Default crank cadence mirrors the configured MagicBlock ER schedule interval. */
export const CRANK_DEFAULT_INTERVAL_MS = MAGICBLOCK_ER.CRANK_DEFAULT_INTERVAL_MS
export const CRANK_DEFAULT_ITERATIONS = 100_000

// Re-export connection function
export { getSolanaConnection as getConnection }

/**
 * Get Anchor provider (base-layer connection).
 */
export function getProvider(wallet: WalletContextState): AnchorProvider | null {
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
export function getProgram(wallet: WalletContextState): Program | null {
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
export function getErProgram(wallet: WalletContextState): Program | null {
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
export function getTeeProgram(wallet: WalletContextState, token?: string): Program | null {
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
  wallet: WalletContextState,
  instructions: TransactionInstruction[]
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: wallet.publicKey!, blockhash, lastValidBlockHeight })
  instructions.forEach((ix) => tx.add(ix))
  const signed = await wallet.signTransaction!(tx)
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true })
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  return sig
}

/**
 * Sign with the wallet, submit, and confirm on the ER by polling signature status. The ER may not
 * simulate the cloned program cleanly (skipPreflight); HTTP status polling avoids WS-subscription
 * token edge cases on a token-authed (TEE) endpoint.
 */
async function sendEr(
  connection: Connection,
  wallet: WalletContextState,
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
  const info = await getSolanaConnection().getAccountInfo(capsulePDA)
  return !!info && info.owner.equals(DELEGATION_PROGRAM_ID)
}

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
  wallet: WalletContextState,
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
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
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
 * liveness heartbeat (update_activity); defaults to the owner.
 */
export async function createCapsule(
  wallet: WalletContextState,
  inactivityPeriodSeconds: number,
  heartbeatAuthority?: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const owner = wallet.publicKey!
  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const [feeConfigPDA] = getFeeConfigPDA()

  const platformFeeRecipient = SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT
    ? new PublicKey(SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT)
    : getProgramId() // sentinel when no fee recipient is configured

  const hb = heartbeatAuthority ?? owner

  // Retry transient RPC failures (503/blockhash/timeout) with exponential backoff.
  const maxRetries = 5
  let lastError: any
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await program.methods
        .createCapsule(new BN(inactivityPeriodSeconds), hb)
        .accountsPartial({
          capsule: capsulePDA,
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
 * Set / replace the on-chain beneficiary list (Solana pubkeys + share_bps; shares must sum to 10000).
 * Owner-only. Routes to the ER when the Switch is delegated, otherwise to the base layer.
 */
export async function updateIntent(
  wallet: WalletContextState,
  beneficiaries: OnChainBeneficiary[]
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const owner = wallet.publicKey!
  const [capsulePDA] = getCapsulePDA(owner)

  const ix = await program.methods
    .updateIntent(beneficiaries.map((b) => ({ pubkey: b.pubkey, shareBps: b.shareBps })))
    .accountsPartial({ capsule: capsulePDA, owner })
    .instruction()

  if (await isCapsuleDelegated(capsulePDA)) {
    const erConnection = new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
    return sendEr(erConnection, wallet, [ix])
  }
  return sendBase(getSolanaConnection(), wallet, [ix])
}

/**
 * Deposit funds into the vault. SOL deposit when no mint is given; SPL deposit otherwise. The vault
 * is never delegated, so this always runs on the base layer. amount is in lamports (SOL) or the
 * mint's base units (SPL).
 */
export async function deposit(
  wallet: WalletContextState,
  amount: number | BN,
  mint?: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const owner = wallet.publicKey!
  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const amt = amount instanceof BN ? amount : new BN(amount)

  const accounts: any = mint
    ? {
        capsule: capsulePDA,
        vault: vaultPDA,
        owner,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
        mint,
        sourceTokenAccount: getAssociatedTokenAddress(mint, owner),
        vaultTokenAccount: getAssociatedTokenAddress(mint, vaultPDA),
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
  wallet: WalletContextState,
  ownerPublicKey: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(ownerPublicKey)
  const [permissionPDA] = getPermissionPDA(capsulePDA, PERMISSION_PROGRAM_ID)

  const ix = await program.methods
    .executeIntent()
    .accountsPartial({
      capsule: capsulePDA,
      permissionProgram: PERMISSION_PROGRAM_ID,
      permission: permissionPDA,
    })
    .instruction()

  if (await isCapsuleDelegated(capsulePDA)) {
    debugLog('[executeIntent] Capsule is delegated, routing through ER RPC')
    const erConnection = new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
    return sendEr(erConnection, wallet, [ix])
  }
  return sendBase(getSolanaConnection(), wallet, [ix])
}

/**
 * Delegate ONLY the Switch (capsule) to a MagicBlock ER validator, creating + delegating the PER
 * permission alongside it. The Vault is never delegated. Runs on the base layer.
 */
export async function delegateCapsule(
  wallet: WalletContextState,
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

  const [permissionPDA] = getPermissionPDA(capsulePDA, PERMISSION_PROGRAM_ID)
  const [bufferPDA] = getBufferPDA(capsulePDA, BUFFER_SEED_PROGRAM_ID)
  const [delegationRecordPDA] = getDelegationRecordPDA(capsulePDA, DELEGATION_PROGRAM_ID)
  const [delegationMetadataPDA] = getDelegationMetadataPDA(capsulePDA, DELEGATION_PROGRAM_ID)
  // Delegation PDAs for the permission account itself (owner_program = permission program).
  const [bufferPermission] = getBufferPDA(permissionPDA, PERMISSION_PROGRAM_ID)
  const [delegationRecordPermission] = getDelegationRecordPDA(permissionPDA, DELEGATION_PROGRAM_ID)
  const [delegationMetadataPermission] = getDelegationMetadataPDA(permissionPDA, DELEGATION_PROGRAM_ID)

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
      permissionProgram: PERMISSION_PROGRAM_ID,
      permission: permissionPDA,
      bufferPermission,
      delegationRecordPermission,
      delegationMetadataPermission,
    } as any)
    .rpc()
}

/**
 * Schedule the autonomous MagicBlock ScheduleTask crank that fires execute_intent on the ER. Takes 5
 * accounts (magic_program, payer, capsule, permission_program, permission). Runs on the ER (or the
 * TEE when a token is supplied).
 */
export async function scheduleExecuteIntent(
  wallet: WalletContextState,
  ownerPublicKey: PublicKey,
  args?: { taskId?: BN; executionIntervalMillis?: BN; iterations?: BN },
  token?: string
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(ownerPublicKey)
  const [permissionPDA] = getPermissionPDA(capsulePDA, PERMISSION_PROGRAM_ID)

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
        permissionProgram: PERMISSION_PROGRAM_ID,
        permission: permissionPDA,
      })
      .instruction()

    const erConnection = token
      ? getTeeConnection(token)
      : new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
    return await sendEr(erConnection, wallet, [ix])
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
  beneficiaries: OnChainBeneficiary[]
  /** Vault funding amount in lamports (SOL) or the mint's base units (SPL). */
  depositBaseUnits: number | BN
  /** SPL mint, or null/undefined for native SOL. */
  mint?: PublicKey | null
  /** Liveness heartbeat authority; defaults to the owner. */
  heartbeatAuthority?: PublicKey
  /** Override the delegation validator; defaults to the TEE node (VALIDATOR_TEE). */
  validator?: PublicKey
  /** True to reuse an executed capsule in place (recreate) instead of create. */
  recreate?: boolean
  /** Autonomous ScheduleTask cadence overrides. */
  schedule?: { taskId?: BN; executionIntervalMillis?: BN; iterations?: BN }
  /** UI progress callback. */
  onStep?: (label: string) => void
}

/**
 * The single, intended capsule-creation flow: create the Switch + Vault, fund it, delegate the Switch
 * to the MagicBlock TEE (Private ER), set the PRIVATE beneficiary list on the TEE copy, and register
 * the autonomous execute_intent crank. Beneficiaries NEVER touch the base layer - they are written only
 * inside the TEE, which is the whole point of the privacy design. There is no base-only fork.
 *
 * Wallet approvals are minimized to two transaction popups plus one auth-token signature:
 *   1. base bundle    - signAllTransactions([create+deposit, delegate]) -> ONE approval, sent in order
 *      (delegate must read the Switch the create tx wrote, so it can't share an instruction list).
 *   2. TEE auth token - getAuthToken mints a per-key token (signMessage) so the TEE accepts our ops.
 *   3. TEE bundle     - update_intent (private beneficiaries) + schedule_execute_intent in one tx.
 */
export async function createDelegatedCapsule(
  wallet: WalletContextState,
  params: CreateDelegatedCapsuleParams
): Promise<{ baseSigs: string[]; teeSig: string; capsule: PublicKey; token: string }> {
  const program = getProgram(wallet)
  if (!program || !wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected')

  const owner = wallet.publicKey
  const programId = getProgramId()
  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const [feeConfigPDA] = getFeeConfigPDA()
  const [permissionPDA] = getPermissionPDA(capsulePDA, PERMISSION_PROGRAM_ID)

  const hb = params.heartbeatAuthority ?? owner
  const validator = params.validator ?? new PublicKey(MAGICBLOCK_ER.VALIDATOR_TEE)
  const mint = params.mint ?? null
  const amt = params.depositBaseUnits instanceof BN ? params.depositBaseUnits : new BN(params.depositBaseUnits)

  const platformFeeRecipient = SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT
    ? new PublicKey(SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT)
    : programId // sentinel when no fee recipient is configured

  // ---- base ix 1: create (or recreate) the Switch ----
  const createIx = params.recreate
    ? await program.methods
        .recreateCapsule(new BN(params.inactivitySeconds))
        .accountsPartial({ capsule: capsulePDA, owner })
        .instruction()
    : await program.methods
        .createCapsule(new BN(params.inactivitySeconds), hb)
        .accountsPartial({
          capsule: capsulePDA,
          vault: vaultPDA,
          owner,
          feeConfig: feeConfigPDA,
          platformFeeRecipient,
          systemProgram: SystemProgram.programId,
        })
        .instruction()

  // ---- base ix 2: deposit (fund the Vault; never delegated) ----
  const depositAccounts: any = mint
    ? {
        capsule: capsulePDA,
        vault: vaultPDA,
        owner,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
        mint,
        sourceTokenAccount: getAssociatedTokenAddress(mint, owner),
        vaultTokenAccount: getAssociatedTokenAddress(mint, vaultPDA),
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
  const depositIx = await program.methods.deposit(amt).accountsPartial(depositAccounts).instruction()

  // ---- base ix 3: delegate ONLY the Switch (+ PER permission) to the TEE validator ----
  const [bufferPDA] = getBufferPDA(capsulePDA, BUFFER_SEED_PROGRAM_ID)
  const [delegationRecordPDA] = getDelegationRecordPDA(capsulePDA, DELEGATION_PROGRAM_ID)
  const [delegationMetadataPDA] = getDelegationMetadataPDA(capsulePDA, DELEGATION_PROGRAM_ID)
  const [bufferPermission] = getBufferPDA(permissionPDA, PERMISSION_PROGRAM_ID)
  const [delegationRecordPermission] = getDelegationRecordPDA(permissionPDA, DELEGATION_PROGRAM_ID)
  const [delegationMetadataPermission] = getDelegationMetadataPDA(permissionPDA, DELEGATION_PROGRAM_ID)
  const delegateIx = await program.methods
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
      permissionProgram: PERMISSION_PROGRAM_ID,
      permission: permissionPDA,
      bufferPermission,
      delegationRecordPermission,
      delegationMetadataPermission,
    } as any)
    .instruction()

  // One wallet approval for the whole base setup. delegate carries a CU bump: create + delegate's
  // permission/delegation CPIs together exceed the 200k default.
  params.onStep?.('Creating, funding & delegating capsule to TEE...')
  const baseConn = getSolanaConnection()
  const baseSigs = await sendBaseBatch(baseConn, wallet, [
    [createIx, depositIx],
    [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), delegateIx],
  ])

  // Wait for the base account to flip to the delegation program before touching the TEE copy.
  params.onStep?.('Waiting for TEE delegation...')
  for (let i = 0; i < 16; i++) {
    if (await isCapsuleDelegated(capsulePDA)) break
    await sleep(2500)
  }

  // Mint the per-key TEE auth token (signMessage) so the Private ER accepts our reads/sends. Cache it
  // so the immediate post-create dashboard/detail read can show live private state without re-prompting.
  params.onStep?.('Authorizing TEE access...')
  const token = await getTeeAuthToken(wallet)
  setCachedTeeToken(owner, token)
  const teeConn = getTeeConnection(token)

  // Wait for the Switch to clone onto the TEE node.
  params.onStep?.('Waiting for TEE sync...')
  for (let i = 0; i < 16; i++) {
    const info = await teeConn.getAccountInfo(capsulePDA).catch(() => null)
    if (info) break
    await sleep(2500)
  }

  // ---- TEE ix 1: set the PRIVATE beneficiary list (only ever written inside the TEE) ----
  const updateIntentIx = await program.methods
    .updateIntent(params.beneficiaries.map((b) => ({ pubkey: b.pubkey, shareBps: b.shareBps })))
    .accountsPartial({ capsule: capsulePDA, owner })
    .instruction()

  // ---- TEE ix 2: register the autonomous execute_intent crank ----
  const taskId = params.schedule?.taskId ?? new BN(Date.now())
  const executionIntervalMillis =
    params.schedule?.executionIntervalMillis ?? new BN(MAGICBLOCK_ER.CRANK_DEFAULT_INTERVAL_MS || 10000)
  const iterations = params.schedule?.iterations ?? new BN(MAGICBLOCK_ER.CRANK_DEFAULT_ITERATIONS || 100_000)
  const scheduleIx = await program.methods
    .scheduleExecuteIntent({ taskId, executionIntervalMillis, iterations })
    .accountsPartial({
      magicProgram: MAGIC_PROGRAM_ID,
      payer: owner,
      capsule: capsulePDA,
      permissionProgram: PERMISSION_PROGRAM_ID,
      permission: permissionPDA,
    })
    .instruction()

  params.onStep?.('Setting private beneficiaries & scheduling crank...')
  const teeSig = await sendEr(teeConn, wallet, [updateIntentIx, scheduleIx])

  return { baseSigs, teeSig, capsule: capsulePDA, token }
}

/**
 * Distribute every vault asset to the on-chain beneficiaries, split by share_bps. SPL legs run first
 * (each closes the vault ATA, returning its rent to the vault); the SOL leg runs last so it sweeps
 * the reclaimed rent too. Must run on the base layer (the Switch undelegated). Returns the last tx sig.
 */
export async function distributeAssets(
  wallet: WalletContextState,
  ownerPublicKey: PublicKey,
  beneficiaries: OnChainBeneficiary[]
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected')
  if (!beneficiaries.length) throw new Error('Capsule has no beneficiaries')

  const [capsulePDA] = getCapsulePDA(ownerPublicKey)
  const [vaultPDA] = getCapsuleVaultPDA(ownerPublicKey)
  const connection = getSolanaConnection()

  if (await isCapsuleDelegated(capsulePDA)) {
    throw new Error('Capsule is still delegated to ER. Please undelegate first before distributing assets.')
  }

  let lastSig = ''

  // 1. SPL legs first.
  const tokenAccts = await connection.getParsedTokenAccountsByOwner(vaultPDA, { programId: TOKEN_PROGRAM_ID })
  for (const { pubkey: vaultAta, account } of tokenAccts.value) {
    const tokenInfo = (account.data as any).parsed?.info
    if (!tokenInfo) continue
    if (BigInt(tokenInfo.tokenAmount.amount) === 0n) continue
    const mint = new PublicKey(tokenInfo.mint)

    const preIxs: TransactionInstruction[] = []
    const remaining = [] as { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
    for (const b of beneficiaries) {
      const bAta = getAssociatedTokenAddress(mint, b.pubkey)
      const exists = await connection.getAccountInfo(bAta)
      if (!exists) preIxs.push(buildCreateAssociatedTokenAccountInstruction(wallet.publicKey, bAta, b.pubkey, mint))
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
    lastSig = await sendBase(connection, wallet, [...preIxs, ix])
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
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: null,
          mint: null,
          vaultTokenAccount: null,
        } as any)
        .remainingAccounts(remaining)
        .instruction()
      lastSig = await sendBase(connection, wallet, [ix])
    }
  }

  if (!lastSig) throw new Error('Nothing to distribute (vault already drained)')
  return lastSig
}

/**
 * Initialize platform fee config (call once after program deploy; authority can update via updateFeeConfig).
 */
export async function initFeeConfig(
  wallet: WalletContextState,
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
  wallet: WalletContextState,
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
export async function updateActivity(wallet: WalletContextState, ownerPublicKey?: PublicKey): Promise<string> {
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

/**
 * Recreate a capsule from an executed (terminal) state, resetting the inactivity timer.
 */
export async function recreateCapsule(
  wallet: WalletContextState,
  inactivityPeriodSeconds: number
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(wallet.publicKey!)

  return program.methods
    .recreateCapsule(new BN(inactivityPeriodSeconds))
    .accountsPartial({ capsule: capsulePDA, owner: wallet.publicKey! })
    .rpc()
}

/**
 * Decode the live state of a DELEGATED Switch. The base account is a delegation stub (its first 32
 * bytes are the validator the Switch was delegated to), so the real state lives on the ER/TEE:
 *   - delegated to the TEE validator: read the TEE node. With the owner's auth token the read returns
 *     the private beneficiaries + fresh liveness; without a token the TEE filters the read (non-private
 *     fields only, beneficiaries hidden) - which is exactly the privacy guarantee.
 *   - delegated to a regular ER validator (legacy): read the regular ER.
 * Returns null only if no candidate yields decodable data (e.g. delegated + read fully blocked).
 */
async function decodeDelegatedCapsule(
  capsulePDA: PublicKey,
  baseInfo: { data: Buffer | Uint8Array; owner: PublicKey },
  token?: string
): Promise<IntentCapsule | null> {
  const stub = Buffer.from(baseInfo.data)
  const isTee =
    stub.length >= 32 && new PublicKey(stub.subarray(0, 32)).equals(new PublicKey(MAGICBLOCK_ER.VALIDATOR_TEE))

  // Candidate live-state buffers, in priority order (most-authoritative first).
  const candidates: Buffer[] = []
  const tryRead = async (conn: Connection) => {
    try {
      const info = await conn.getAccountInfo(capsulePDA)
      if (info?.data) candidates.push(Buffer.from(info.data))
    } catch {
      /* keep trying other candidates */
    }
  }

  if (isTee) {
    if (token) await tryRead(getTeeConnection(token)) // owner-authed: full private state
    await tryRead(getTeeConnection()) // unauth: non-private fields (beneficiaries filtered)
  } else {
    await tryRead(new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' }))
  }

  for (const buf of candidates) {
    const capsule = tryDecodeIntentCapsule(buf)
    if (capsule) {
      capsule.accountOwner = baseInfo.owner
      return capsule
    }
  }
  return null
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

    // Delegated: the base account is a stub - read the live copy from the TEE/ER. Use the passed token,
    // or a token cached for this owner this session (e.g. seeded by createDelegatedCapsule).
    if (accountInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
      return decodeDelegatedCapsule(capsulePDA, accountInfo, token ?? getCachedTeeToken(owner))
    }

    const capsule = decodeIntentCapsule(accountInfo.data)
    capsule.accountOwner = accountInfo.owner
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

    // Delegated: read the live copy from the TEE/ER (token unlocks the private beneficiaries).
    const capsule = accountInfo.owner.equals(DELEGATION_PROGRAM_ID)
      ? await decodeDelegatedCapsule(capsulePda, accountInfo, token)
      : (() => {
          const c = decodeIntentCapsule(accountInfo.data)
          c.accountOwner = accountInfo.owner
          return c
        })()

    if (!capsule) return null
    return { ...capsule, capsuleAddress: capsulePda.toBase58() }
  } catch {
    return null
  }
}

/**
 * Commit + undelegate the Switch (and its PER permission) from the ER back to the base layer
 * (crank_undelegate: 7 lean accounts). Gated on-chain to fired capsules. Waits for the base account
 * to be program-owned again before returning.
 */
export async function undelegateCapsule(
  wallet: WalletContextState,
  ownerPublicKey?: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected')

  const ownerKey = ownerPublicKey ?? wallet.publicKey
  const [capsulePDA] = getCapsulePDA(ownerKey)
  const [permissionPDA] = getPermissionPDA(capsulePDA, PERMISSION_PROGRAM_ID)
  const programId = getProgramId()

  const ix = await program.methods
    .crankUndelegate()
    .accountsPartial({
      payer: wallet.publicKey,
      owner: ownerKey,
      capsule: capsulePDA,
      permission: permissionPDA,
      permissionProgram: PERMISSION_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction()

  const erConnection = new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
  const txSig = await sendEr(erConnection, wallet, [ix])

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

  const capsuleReady = await waitForBaseProgramOwner(capsulePDA)
  if (!capsuleReady) {
    throw new Error('Undelegation submitted but not yet visible on base layer')
  }

  debugLog('[undelegateCapsule] Success. Tx:', txSig)
  return txSig
}

/**
 * Finalize an undelegation on the base layer after the ER committed the account.
 */
export async function processUndelegation(
  wallet: WalletContextState,
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
  wallet: WalletContextState,
  ownerPublicKey?: PublicKey,
  mint?: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const owner = ownerPublicKey ?? wallet.publicKey
  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)

  const accounts: any = mint
    ? {
        capsule: capsulePDA,
        vault: vaultPDA,
        owner,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        mint,
        vaultTokenAccount: getAssociatedTokenAddress(mint, vaultPDA),
        ownerTokenAccount: getAssociatedTokenAddress(mint, owner),
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

  return program.methods.recoverVault().accountsPartial(accounts).rpc()
}

/**
 * Cancel (close) a capsule, reclaiming SOL from the vault and account rent. Owner-only. SPL capsules
 * need the token-refund accounts; SOL capsules leave them null.
 */
export async function cancelCapsule(wallet: WalletContextState, mint?: PublicKey): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const owner = wallet.publicKey
  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)

  const accounts: any = mint
    ? {
        capsule: capsulePDA,
        vault: vaultPDA,
        owner,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        mint,
        vaultTokenAccount: getAssociatedTokenAddress(mint, vaultPDA),
        ownerTokenAccount: getAssociatedTokenAddress(mint, owner),
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

  return program.methods.cancelCapsule().accountsPartial(accounts).rpc()
}

// Re-export types
export type { IntentCapsule } from '@/types'

/**
 * Solana program interaction utilities
 */

import { SystemProgram, PublicKey, Connection, SendTransactionError, Transaction, TransactionInstruction } from '@solana/web3.js'
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor'
import type { Wallet } from '@coral-xyz/anchor'
const WalletClass = (require('@coral-xyz/anchor').Wallet || (AnchorProvider.prototype as any).wallet)
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
import { SOLANA_CONFIG, PLATFORM_FEE, MAGICBLOCK_ER, PER_TEE } from '@/constants'
import { TEE_AUTH } from './tee'
import { debugLog } from '@/lib/log'
import type { IntentCapsule } from '@/types'
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      owner.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
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
 * Get Anchor provider
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
 * Get Anchor program instance. 
 * Using Magic Router connection ensures dynamic routing to ER or Base Layer.
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
 * Get Anchor program instance for TEE.
 * Uses direct TEE connection (authenticated if token provided).
 */
/**
 * Get Program instance connected to ER RPC (Asia devnet) for delegation & scheduling.
 * For PER (private) flows, pass a TEE auth token.
 */
export function getErProgram(wallet: WalletContextState): Program | null {
  if (!wallet.publicKey || !wallet.signTransaction) {
    return null
  }

  const { Connection: SolConnection } = require('@solana/web3.js')
  const connection = new SolConnection(MAGICBLOCK_ER.ER_RPC_URL, {
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

/**
 * Create a new Intent Capsule with retry logic for RPC errors
 */
export async function createCapsule(
  wallet: WalletContextState,
  inactivityPeriodSeconds: number,
  intentData: Uint8Array,
  mint?: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(wallet.publicKey!)
  const [vaultPDA] = getCapsuleVaultPDA(wallet.publicKey!)
  const [feeConfigPDA] = getFeeConfigPDA()

  const platformFeeRecipient = SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT
    ? new PublicKey(SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT)
    : (wallet.publicKey as PublicKey)

  // Convert Uint8Array to Buffer for Anchor (required by Blob.encode)
  // In browser environment, use Buffer polyfill or convert to number array
  let intentDataBuffer: Buffer | number[]
  if (typeof Buffer !== 'undefined') {
    intentDataBuffer = Buffer.from(intentData)
  } else {
    // Fallback for environments without Buffer
    intentDataBuffer = Array.from(intentData)
  }

  // Retry logic for RPC errors (503, service unavailable, etc.)
  const maxRetries = 5
  let lastError: any

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const accounts: any = {
        capsule: capsulePDA,
        vault: vaultPDA,
        owner: wallet.publicKey!,
        feeConfig: feeConfigPDA,
        platformFeeRecipient: platformFeeRecipient || null,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        mint: mint || null,
        sourceTokenAccount: mint ? getAssociatedTokenAddress(mint, wallet.publicKey!) : null,
        vaultTokenAccount: mint ? getAssociatedTokenAddress(mint, vaultPDA) : null,
        associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
      }

      debugLog('[createCapsule] Accounts:', Object.keys(accounts).map(k => `${k}: ${accounts[k]?.toString()}`))

      const tx = await program.methods
        .createCapsule(new BN(inactivityPeriodSeconds), intentDataBuffer)
        .accounts(accounts)
        .rpc()

      return tx
    } catch (error: any) {
      lastError = error

      // Check if it's a retryable RPC error
      const errorMessage = error?.message || ''
      const isRetryableError =
        errorMessage.includes('503') ||
        errorMessage.includes('Service unavailable') ||
        errorMessage.includes('failed to get recent blockhash') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('network')

      if (isRetryableError && attempt < maxRetries - 1) {
        // Wait before retry (exponential backoff: 2s, 4s, 8s, 16s)
        const delay = Math.min(2000 * Math.pow(2, attempt), 16000)
        debugLog(`RPC error (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      // If it's not a retryable error or max retries reached, throw
      throw error
    }
  }

  // If all retries failed, throw with a user-friendly message
  if (lastError?.message?.includes('503') || lastError?.message?.includes('Service unavailable')) {
    throw new Error('RPC 서버가 일시적으로 사용 불가능합니다. 잠시 후 다시 시도해주세요.\nRPC server is temporarily unavailable. Please try again in a few moments.')
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
 * Update intent data
 */
export async function updateIntent(
  wallet: WalletContextState,
  newIntentData: Uint8Array
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(wallet.publicKey!)

  // Convert Uint8Array to Buffer for Anchor (required by Blob.encode)
  let intentDataBuffer: Buffer | number[]
  if (typeof Buffer !== 'undefined') {
    intentDataBuffer = Buffer.from(newIntentData)
  } else {
    // Fallback for environments without Buffer
    intentDataBuffer = Array.from(newIntentData)
  }

  const tx = await program.methods
    .updateIntent(intentDataBuffer)
    .accounts({
      capsule: capsulePDA,
      owner: wallet.publicKey!,
    })
    .rpc()

  return tx
}

/**
 * Execute intent when inactivity period is met. Anyone can call (no owner signature required).
 * Caller pays tx fee; SOL is transferred from capsule vault to platform (fee) and beneficiaries.
 */
export async function executeIntent(
  wallet: WalletContextState,
  ownerPublicKey: PublicKey,
  beneficiaries?: Array<{ chain?: 'solana' | 'evm'; address: string; amount: string; amountType: string }>,
  mint?: PublicKey
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(ownerPublicKey)
  const [vaultPDA] = getCapsuleVaultPDA(ownerPublicKey)

  const permissionProgramId = new PublicKey(MAGICBLOCK_ER.PERMISSION_PROGRAM_ID)
  const [permissionPDA] = getPermissionPDA(capsulePDA, permissionProgramId)

  const accounts: any = {
    capsule: capsulePDA,
    vault: vaultPDA,
    permissionProgram: permissionProgramId,
    permission: permissionPDA,
  }

  const remainingAccounts = beneficiaries
    ?.filter((b) => (b.chain ?? 'solana') === 'solana')
    .map((b) => {
    const beneficiaryOwner = new PublicKey(b.address)
    if (mint && !mint.equals(PublicKey.default)) {
      const beneficiaryAta = getAssociatedTokenAddress(mint, beneficiaryOwner)
      return {
        pubkey: beneficiaryAta,
        isSigner: false,
        isWritable: true,
      }
    }
    return {
      pubkey: beneficiaryOwner,
      isSigner: false,
      isWritable: true,
    }
  }) || []

  // Check if capsule is delegated — if so, route through ER RPC (Asia devnet)
  const baseConnection = getSolanaConnection()
  const accountInfo = await baseConnection.getAccountInfo(capsulePDA)
  const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
  const isDelegated = accountInfo && accountInfo.owner.equals(delegationProgramId)

  if (isDelegated) {
    debugLog('[executeIntent] Capsule is delegated, routing through ER RPC')
    // Use raw instruction with 4 required accounts (deployed binary accepts 4-7 accounts;
    // optional accounts default to None when not provided)
    const programId = getProgramId()
    const discriminator = Buffer.from([53, 130, 47, 154, 227, 220, 122, 212]) // execute_intent
    const keys = [
      { pubkey: capsulePDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: permissionProgramId, isSigner: false, isWritable: false },
      { pubkey: permissionPDA, isSigner: false, isWritable: false },
    ]
    const ix = new TransactionInstruction({ keys, programId, data: discriminator })

    const erConnection = new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
    const { blockhash, lastValidBlockHeight } = await erConnection.getLatestBlockhash('confirmed')

    const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight })
    tx.add(ix)

    const signedTx = await wallet.signTransaction!(tx)
    const txSignature = await erConnection.sendRawTransaction(signedTx.serialize(), { skipPreflight: true })
    await erConnection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, 'confirmed')

    return txSignature
  }

  // Not delegated — send to base layer using manual instruction
  // Deployed program's execute_intent only needs 4 accounts (IDL shows 10 but binary differs)

  const programId = getProgramId()
  const discriminator = Buffer.from([53, 130, 47, 154, 227, 220, 122, 212]) // execute_intent
  const keys = [
    { pubkey: capsulePDA, isSigner: false, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: permissionProgramId, isSigner: false, isWritable: false },
    { pubkey: permissionPDA, isSigner: false, isWritable: false },
  ]
  const ix = new TransactionInstruction({ keys, programId, data: discriminator })
  const connection = getSolanaConnection()
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight })
  tx.add(ix)
  const signedTx = await wallet.signTransaction!(tx)
  const txSignature = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: true })
  await connection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, 'confirmed')
  return txSignature
}

/**
 * Delegate capsule PDA to Magicblock ER.
 * Defaults to Asia devnet validator (ACTIVE_VALIDATOR). Pass validatorPubkey to override.
 */
export async function delegateCapsule(
  wallet: WalletContextState,
  validatorPubkey?: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(wallet.publicKey)
  const activeValidator = validatorPubkey ?? new PublicKey(MAGICBLOCK_ER.ACTIVE_VALIDATOR)
  debugLog('[delegateCapsule] Using validator:', activeValidator.toBase58())

  // Verify capsule account exists and is owned by our program
  const connection = getSolanaConnection()
  const accountInfo = await connection.getAccountInfo(capsulePDA)
  if (!accountInfo) {
    throw new Error('Capsule account not found. Please create a capsule first.')
  }

  const magicProgramId = new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID)
  const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)

  // Check if already delegated
  if (accountInfo.owner.equals(delegationProgramId)) {
    debugLog('Capsule is already delegated to MagicBlock (Ephemereality). Proceeding...')
    return 'ALREADY_DELEGATED'
  }

  if (!accountInfo.owner.equals(getProgramId())) {
    throw new Error(`Capsule is not owned by the Heres Program. Current owner: ${accountInfo.owner.toBase58()}`)
  }

  const [vaultPDA] = getCapsuleVaultPDA(wallet.publicKey)

  // Buffer PDAs use BUFFER_SEED_PROGRAM_ID (deployed program baked its own ID into #[delegate] macro)
  const bufferSeedProgramId = new PublicKey(MAGICBLOCK_ER.BUFFER_SEED_PROGRAM_ID)
  const [bufferPDA] = getBufferPDA(capsulePDA, bufferSeedProgramId)
  const [delegationRecordPDA] = getDelegationRecordPDA(capsulePDA, delegationProgramId)
  const [delegationMetadataPDA] = getDelegationMetadataPDA(capsulePDA, delegationProgramId)

  // Derive PDAs for Vault delegation
  const [vaultBufferPDA] = getBufferPDA(vaultPDA, bufferSeedProgramId)
  const [vaultDelegationRecordPDA] = getDelegationRecordPDA(vaultPDA, delegationProgramId)
  const [vaultDelegationMetadataPDA] = getDelegationMetadataPDA(vaultPDA, delegationProgramId)

  const accounts = {
    payer: wallet.publicKey,
    owner: wallet.publicKey,
    validator: activeValidator,
    pda: capsulePDA,
    pdaBuffer: bufferPDA,
    pdaDelegationRecord: delegationRecordPDA,
    pdaDelegationMetadata: delegationMetadataPDA,
    vault: vaultPDA,
    vaultBuffer: vaultBufferPDA,
    vaultDelegationRecord: vaultDelegationRecordPDA,
    vaultDelegationMetadata: vaultDelegationMetadataPDA,
    // Programs at the end
    magicProgram: magicProgramId,
    delegationProgram: delegationProgramId,
    systemProgram: SystemProgram.programId,
  }

  const tx = await program.methods
    .delegateCapsule()
    // @ts-ignore
    .accounts(accounts)
    .rpc()

  return tx
}



/**
 * Schedule crank to run execute_intent at intervals (Magicblock ScheduleTask).
 * When conditions are met, anyone (including crank) can call execute_intent without owner signature.
 */
export async function scheduleExecuteIntent(
  wallet: WalletContextState,
  ownerPublicKey: PublicKey,
  args?: { taskId?: BN; executionIntervalMillis?: BN; iterations?: BN },
  token?: string
): Promise<string> {
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(ownerPublicKey)
  const [vaultPDA] = getCapsuleVaultPDA(ownerPublicKey)

  const magicProgram = new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID)
  const permissionProgramId = new PublicKey(MAGICBLOCK_ER.PERMISSION_PROGRAM_ID)
  const [permissionPDA] = getPermissionPDA(capsulePDA, permissionProgramId)
  const programId = getProgramId()

  // Default values for optional args
  const taskId = args?.taskId ?? new BN(Date.now());
  const executionIntervalMillis = args?.executionIntervalMillis ?? new BN(MAGICBLOCK_ER.CRANK_DEFAULT_INTERVAL_MS || 60000);
  const iterations = args?.iterations ?? new BN(MAGICBLOCK_ER.CRANK_DEFAULT_ITERATIONS || 0);

  debugLog('[scheduleExecuteIntent] Scheduling on ER RPC (Asia devnet)')
  debugLog('[scheduleExecuteIntent] Capsule:', capsulePDA.toBase58())
  debugLog('[scheduleExecuteIntent] Payer:', wallet.publicKey.toBase58())

  // Build manual TransactionInstruction matching deployed binary (7 accounts).
  // magic_program, payer, capsule, vault, permission_program, permission, magic_context.
  // Using Anchor's .methods builder causes position mismatch; use raw TX instead.
  const discriminator = Buffer.from([88, 30, 30, 42, 9, 75, 31, 189]) // schedule_execute_intent
  const argsBuf = Buffer.alloc(24)
  argsBuf.writeBigUInt64LE(BigInt(taskId.toString()), 0)
  argsBuf.writeBigUInt64LE(BigInt(executionIntervalMillis.toString()), 8)
  argsBuf.writeBigUInt64LE(BigInt(iterations.toString()), 16)
  const data = Buffer.concat([discriminator, argsBuf])

  const magicContextId = new PublicKey(MAGICBLOCK_ER.MAGIC_CONTEXT)
  const keys = [
    { pubkey: magicProgram, isSigner: false, isWritable: false },
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: capsulePDA, isSigner: false, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: permissionProgramId, isSigner: false, isWritable: false },
    { pubkey: permissionPDA, isSigner: false, isWritable: false },
    { pubkey: magicContextId, isSigner: false, isWritable: true },
  ]

  const ix = new TransactionInstruction({ keys, programId, data })

  try {
    const erRpcUrl = MAGICBLOCK_ER.ER_RPC_URL
    const erConnection = new Connection(erRpcUrl, { commitment: 'confirmed' })

    const { blockhash, lastValidBlockHeight } = await erConnection.getLatestBlockhash('confirmed');
    const tx = new Transaction({
      feePayer: wallet.publicKey,
      blockhash,
      lastValidBlockHeight,
    });
    tx.add(ix);

    // Sign via wallet adapter
    const signedTx = await wallet.signTransaction!(tx);
    debugLog('[scheduleExecuteIntent] Sending signed tx to ER RPC...');

    const txSignature = await erConnection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: true,
    });
    debugLog('[scheduleExecuteIntent] Tx sent, confirming...', txSignature);
    await erConnection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, 'confirmed');

    debugLog('[scheduleExecuteIntent] Success! TX:', txSignature);
    return txSignature;
  } catch (err: any) {
    console.error('[scheduleExecuteIntent] ✗ Error:', err);

    // Better error message translation
    let errorMessage = err.message || 'Unknown error';
    let logs: string[] | null = null;

    if (err instanceof SendTransactionError || err.name === 'SendTransactionError') {
      logs = err.logs || null;
      if (!logs && typeof err.getLogs === 'function') {
        try {
          // Some environments might need the connection passed or have issues with getLogs
          logs = await err.getLogs();
        } catch (e) {
          console.error('[scheduleExecuteIntent] ✗ Failed to get logs from err.getLogs():', e);
          // Fallback: try to see if logs are in the error message or other fields
          if (err.message && err.message.includes('logs:')) {
            logs = [err.message];
          }
        }
      }
    } else if (err.logs) {
      logs = err.logs;
    }

    if (logs) {
      console.error('[scheduleExecuteIntent] ✗ Transaction Logs:', logs);
      // Try to extract a more descriptive error from logs if it's an Anchor error
      const anchorError = logs.find(l => l.includes('AnchorError'));
      if (anchorError) {
        errorMessage = `Anchor Error: ${anchorError.split('AnchorError thrown in ')[1] || anchorError}`;
      } else if (logs.some(l => l.includes('invalid instruction data'))) {
        errorMessage = 'Invalid instruction data: The TEE may be expecting a different account or argument format.';
      }
    }

    const finalError = new Error(`Crank scheduling failed: ${errorMessage}`);
    // @ts-ignore
    finalError.logs = logs;
    // @ts-ignore
    finalError.originalError = err;

    throw finalError;
  }
}

/**
 * Distribute assets from vault to beneficiaries after execute_intent has been called (ER commit to base).
 */
export async function distributeAssets(
  wallet: WalletContextState,
  ownerPublicKey: PublicKey,
  beneficiaries?: Array<{ chain?: 'solana' | 'evm'; address: string; amount: string; amountType: string }>,
  mint?: PublicKey
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(ownerPublicKey)
  const [vaultPDA] = getCapsuleVaultPDA(ownerPublicKey)
  const [feeConfigPDA] = getFeeConfigPDA()
  const platformFeeRecipient = SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT
    ? new PublicKey(SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT)
    : null

  const accounts: any = {
    capsule: capsulePDA,
    vault: vaultPDA,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    feeConfig: feeConfigPDA,
    platformFeeRecipient: platformFeeRecipient || null,
    mint: mint || null,
    vaultTokenAccount: mint ? getAssociatedTokenAddress(mint, vaultPDA) : null,
  }

  const remainingAccounts = beneficiaries
    ?.filter((b) => (b.chain ?? 'solana') === 'solana')
    .map((b) => {
    const beneficiaryOwner = new PublicKey(b.address)
    if (mint && !mint.equals(PublicKey.default)) {
      const beneficiaryAta = getAssociatedTokenAddress(mint, beneficiaryOwner)
      return {
        pubkey: beneficiaryAta,
        isSigner: false,
        isWritable: true,
      }
    }
    return {
      pubkey: beneficiaryOwner,
      isSigner: false,
      isWritable: true,
    }
  }) || []

  debugLog('[distributeAssets] Calling with beneficiaries:', beneficiaries?.length || 0)

  // Check if capsule is delegated — if so, route through ER RPC
  const baseConnection = getSolanaConnection()
  const accountInfo = await baseConnection.getAccountInfo(capsulePDA)
  const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
  const isDelegated = accountInfo && accountInfo.owner.equals(delegationProgramId)

  if (isDelegated) {
    // distribute_assets transfers SOL via invoke_signed, which cannot run on ER.
    // The capsule must be undelegated back to base layer first.
    throw new Error('Capsule is still delegated to ER. Please undelegate first before distributing assets.')
  }

  // Not delegated — send to base layer using manual instruction
  // distribute_assets is in the deployed binary but NOT in the IDL

  const programId = getProgramId()
  const isSpl = mint && !mint.equals(PublicKey.default)

  // Read on-chain fee_config to get actual fee_recipient
  const baseConn = getSolanaConnection()
  let feeRecipient: PublicKey
  try {
    const feeInfo = await baseConn.getAccountInfo(feeConfigPDA)
    if (feeInfo) {
      const { BorshAccountsCoder } = await import('@coral-xyz/anchor')
      const coder = new BorshAccountsCoder(idl as any)
      const feeData = coder.decode('FeeConfig', feeInfo.data)
      feeRecipient = new PublicKey(feeData.fee_recipient ?? feeData.feeRecipient)
    } else {
      feeRecipient = platformFeeRecipient || new PublicKey('Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb')
    }
  } catch {
    feeRecipient = platformFeeRecipient || new PublicKey('Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb')
  }

  const preInstructions: TransactionInstruction[] = []
  const feeRecipientAccount = isSpl && mint
    ? getAssociatedTokenAddress(mint, feeRecipient)
    : feeRecipient
  if (isSpl && mint) {
    const feeRecipientAtaInfo = await baseConn.getAccountInfo(feeRecipientAccount)
    if (!feeRecipientAtaInfo) {
      preInstructions.push(
        buildCreateAssociatedTokenAccountInstruction(
          wallet.publicKey,
          feeRecipientAccount,
          feeRecipient,
          mint
        )
      )
    }
  }

  // distribute_assets discriminator: sha256("global:distribute_assets")[0..8]
  const discriminator = Buffer.from([239, 241, 19, 219, 144, 191, 154, 18])
  const keys = [
    { pubkey: capsulePDA, isSigner: false, isWritable: false },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: feeConfigPDA, isSigner: false, isWritable: false },
    { pubkey: feeRecipientAccount, isSigner: false, isWritable: true },
    // optional: mint (sentinel for None)
    { pubkey: isSpl ? mint : programId, isSigner: false, isWritable: false },
    // optional: vault_token_account (sentinel for None)
    { pubkey: isSpl ? getAssociatedTokenAddress(mint!, vaultPDA) : programId, isSigner: false, isWritable: !!isSpl },
    ...remainingAccounts,
  ]

  const ix = new TransactionInstruction({ keys, programId, data: discriminator })
  const { blockhash, lastValidBlockHeight } = await baseConn.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight })
  preInstructions.forEach((instruction) => tx.add(instruction))
  tx.add(ix)
  const signedTx = await wallet.signTransaction!(tx)
  const txSignature = await baseConn.sendRawTransaction(signedTx.serialize(), { skipPreflight: true })
  await baseConn.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, 'confirmed')
  return txSignature
}

/**
 * Initialize platform fee config (call once after program deploy; authority can update later via updateFeeConfig).
 * 湲곕낯 ?섏닔猷? ?앹꽦 0.05 SOL, ?ㅽ뻾 3% ??PLATFORM_FEE.CREATION_FEE_LAMPORTS, PLATFORM_FEE.EXECUTION_FEE_BPS ?ъ슜.
 * @param creationFeeLamports - SOL lamports charged per capsule creation (0 to disable)
 * @param executionFeeBps - Execution fee in basis points (10000 = 100%; 300 = 3%)
 */
export async function initFeeConfig(
  wallet: WalletContextState,
  feeRecipient: PublicKey,
  creationFeeLamports: number = PLATFORM_FEE.CREATION_FEE_LAMPORTS,
  executionFeeBps: number = PLATFORM_FEE.EXECUTION_FEE_BPS
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  const [feeConfigPDA] = getFeeConfigPDA()
  const tx = await program.methods
    .initFeeConfig(feeRecipient, new BN(creationFeeLamports), executionFeeBps)
    .accounts({
      feeConfig: feeConfigPDA,
      authority: wallet.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc()
  return tx
}

/**
 * Update platform fee config (authority only).
 */
export async function updateFeeConfig(
  wallet: WalletContextState,
  creationFeeLamports: number,
  executionFeeBps: number
): Promise<string> {
  if (executionFeeBps > 10000) throw new Error('executionFeeBps must be <= 10000')
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  const [feeConfigPDA] = getFeeConfigPDA()
  const tx = await program.methods
    .updateFeeConfig(new BN(creationFeeLamports), executionFeeBps)
    .accounts({
      feeConfig: feeConfigPDA,
      authority: wallet.publicKey!,
    })
    .rpc()
  return tx
}

/**
 * Read SOL/USD (or other) price from Pyth Lazer / ephemeral oracle price feed (requires program built with --features oracle)
 */
export async function samplePrice(
  wallet: WalletContextState,
  priceUpdateAccount: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const tx = await program.methods
    .samplePrice()
    .accounts({
      payer: wallet.publicKey!,
      priceUpdate: priceUpdateAccount,
    })
    .rpc()

  return tx
}

/**
 * Update activity timestamp
 */
export async function updateActivity(wallet: WalletContextState): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(wallet.publicKey!)

  const tx = await program.methods
    .updateActivity()
    .accounts({
      capsule: capsulePDA,
      owner: wallet.publicKey!,
    })
    .rpc()

  return tx
}

/**
 * Restart the inactivity timer (Fail-safe / Auto-restart)
 */
export async function restartTimer(wallet: WalletContextState, ownerPublicKey: PublicKey): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(ownerPublicKey)

  const tx = await program.methods
    .restartTimer()
    .accounts({
      capsule: capsulePDA,
      authority: wallet.publicKey!,
    })
    .rpc()

  return tx
}


/**
 * Recreate capsule from executed state
 */
export async function recreateCapsule(
  wallet: WalletContextState,
  inactivityPeriodSeconds: number,
  intentData: Uint8Array,
  mint?: PublicKey
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(wallet.publicKey!)
  const [vaultPDA] = getCapsuleVaultPDA(wallet.publicKey!)
  const [feeConfigPDA] = getFeeConfigPDA()

  // Convert Uint8Array to Buffer for Anchor (required by Blob.encode)
  let intentDataBuffer: Buffer | number[]
  if (typeof Buffer !== 'undefined') {
    intentDataBuffer = Buffer.from(intentData)
  } else {
    // Fallback for environments without Buffer
    intentDataBuffer = Array.from(intentData)
  }

  const accounts: {
    capsule: PublicKey
    vault: PublicKey
    owner: PublicKey
    systemProgram: PublicKey
    feeConfig: PublicKey
    tokenProgram: PublicKey
    mint: PublicKey | null
    sourceTokenAccount: PublicKey | null
    vaultTokenAccount: PublicKey | null
  } = {
    capsule: capsulePDA,
    vault: vaultPDA,
    owner: wallet.publicKey!,
    systemProgram: SystemProgram.programId,
    feeConfig: feeConfigPDA,
    tokenProgram: TOKEN_PROGRAM_ID,
    mint: null,
    sourceTokenAccount: null,
    vaultTokenAccount: null,
  }

  if (mint) {
    accounts.mint = mint
    accounts.sourceTokenAccount = getAssociatedTokenAddress(mint, wallet.publicKey!)
    accounts.vaultTokenAccount = getAssociatedTokenAddress(mint, vaultPDA)
  }

  const tx = await program.methods
    .recreateCapsule(new BN(inactivityPeriodSeconds), intentDataBuffer)
    // @ts-ignore
    .accounts(accounts)
    .rpc()

  return tx
}

/**
 * Fetch capsule data
 */
export async function getCapsule(owner: PublicKey): Promise<IntentCapsule | null> {
  const connection = getSolanaConnection()
  const fallbackConnection = getSolanaFallbackConnection()
  const [capsulePDA] = getCapsulePDA(owner)

  try {
    debugLog('Fetching capsule for owner:', owner.toString())
    debugLog('Capsule PDA:', capsulePDA.toString())

    // Retry logic for RPC errors
    const maxRetries = 3
    let accountInfo = null
    let lastError: any

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Use Anchor's account decoder to parse the account
        // We need a provider to use Program.account, but we can decode manually
        accountInfo = await connection.getAccountInfo(capsulePDA)
        debugLog(`Account info (attempt ${attempt + 1}):`, accountInfo ? 'Found' : 'Not found')
        break // Success, exit retry loop
      } catch (error: any) {
        lastError = error
        const errorMessage = error?.message || ''
        const isRetryableError =
          errorMessage.includes('429') ||
          errorMessage.includes('Too Many Requests') ||
          errorMessage.includes('too many requests') ||
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
          debugLog(`RPC error (attempt ${attempt + 1}/${maxRetries}): ${errorMessage}, retrying in ${delay}ms...`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
        throw error // Not retryable or max retries reached
      }
    }

    if (!accountInfo && lastError) {
      try {
        debugLog('Primary capsule fetch failed, retrying with fallback RPC...')
        accountInfo = await fallbackConnection.getAccountInfo(capsulePDA)
      } catch (fallbackError: any) {
        debugLog('Fallback capsule fetch also failed:', fallbackError?.message || fallbackError)
      }
    }

    if (!accountInfo || !accountInfo.data) {
      debugLog('No account info or data found for capsule:', {
        owner: owner.toString(),
        capsulePda: capsulePDA.toString(),
      })
      return null
    }

    // Check if the account is delegated to MagicBlock ER
    const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
    if (accountInfo.owner.equals(delegationProgramId)) {
      debugLog('Account is delegated. Re-fetching from ER RPC...')
      const { Connection: SolConnection } = require('@solana/web3.js')
      const erConn = new SolConnection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
      const erAccountInfo = await erConn.getAccountInfo(capsulePDA)
      if (erAccountInfo && erAccountInfo.data) {
        debugLog('Successfully fetched delegated state from ER RPC')
        accountInfo.data = erAccountInfo.data
      }
    }

    // Anchor accounts start with an 8-byte discriminator
    const dataToParse = accountInfo.data
    let offset = 8

    // owner: Pubkey (32 bytes)
    const ownerBytes = dataToParse.slice(offset, offset + 32)
    const ownerPubkey = new PublicKey(ownerBytes)
    offset += 32

    // Helper function to read i64 (little-endian)
    const readI64 = (bytes: Uint8Array, start: number): bigint => {
      let result = 0n
      for (let i = 0; i < 8; i++) {
        result |= BigInt(bytes[start + i]) << BigInt(i * 8)
      }
      if (result & (1n << 63n)) {
        result = result - (1n << 64n)
      }
      return result
    }

    // Helper function to read u32 (little-endian)
    const readU32 = (bytes: Uint8Array, start: number): number => {
      return bytes[start] | (bytes[start + 1] << 8) | (bytes[start + 2] << 16) | (bytes[start + 3] << 24)
    }

    // inactivity_period: i64 (8 bytes, little-endian)
    const inactivityPeriod = readI64(dataToParse, offset)
    offset += 8

    // last_activity: i64 (8 bytes, little-endian)
    const lastActivity = readI64(dataToParse, offset)
    offset += 8

    // intent_data: Vec<u8> (4 bytes length + data)
    const intentDataLength = readU32(dataToParse, offset)
    offset += 4
    const intentDataBytes = dataToParse.slice(offset, offset + intentDataLength)
    offset += intentDataLength

    // is_active: bool (1 byte)
    const isActive = dataToParse[offset] === 1
    offset += 1

    // executed_at: Option<i64> (1 byte for Some/None + 8 bytes if Some)
    let executedAt: number | null = null
    const hasExecutedAt = dataToParse[offset] === 1
    offset += 1
    if (hasExecutedAt) {
      executedAt = Number(readI64(dataToParse, offset))
      offset += 8
    }

    const capsule: IntentCapsule & { accountOwner: PublicKey } = {
      owner: ownerPubkey,
      inactivityPeriod: Number(inactivityPeriod),
      lastActivity: Number(lastActivity),
      intentData: new Uint8Array(intentDataBytes),
      isActive,
      executedAt,
      accountOwner: accountInfo.owner,
      mint: undefined,
    }

    // Skip bump (1) and vault_bump (1)
    offset += 2
    if (offset + 32 <= dataToParse.length) {
      capsule.mint = new PublicKey(dataToParse.slice(offset, offset + 32))
    }

    debugLog('Successfully fetched capsule:', {
      requestedOwner: owner.toString(),
      owner: capsule.owner.toString(),
      isActive: capsule.isActive,
      executedAt: capsule.executedAt,
      inactivityPeriod: capsule.inactivityPeriod,
      accountOwner: capsule.accountOwner.toString(),
      mint: capsule.mint?.toString(),
    })

    return capsule
  } catch (error) {
    console.error('Error fetching capsule:', error)
    console.error('Owner:', owner.toString())
    console.error('PDA:', capsulePDA.toString())
    // Re-throw error so caller can handle it
    throw error
  }
}

/**
 * Fetch capsule by its PDA (capsule account address).
 * Used on capsule detail page when URL has /capsules/[address].
 */
export async function getCapsuleByAddress(capsulePda: PublicKey): Promise<(IntentCapsule & { capsuleAddress: string }) | null> {
  const connection = getSolanaConnection()
  try {
    const accountInfo = await connection.getAccountInfo(capsulePda)
    if (!accountInfo || !accountInfo.data) return null
    if (accountInfo.data.length < 60) return null

    // Check if the account is delegated to MagicBlock ER
    const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
    if (accountInfo.owner.equals(delegationProgramId)) {
      const { Connection: SolConnection } = require('@solana/web3.js')
      const erConn = new SolConnection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
      const erAccountInfo = await erConn.getAccountInfo(capsulePda)
      if (erAccountInfo && erAccountInfo.data) {
        accountInfo.data = erAccountInfo.data
      }
    }

    const dataToParse = accountInfo.data
    const readI64 = (bytes: Uint8Array, start: number): bigint => {
      let result = 0n
      for (let i = 0; i < 8; i++) {
        result |= BigInt(bytes[start + i]) << BigInt(i * 8)
      }
      if (result & (1n << 63n)) result = result - (1n << 64n)
      return result
    }
    const readU32 = (bytes: Uint8Array, start: number): number =>
      bytes[start] | (bytes[start + 1] << 8) | (bytes[start + 2] << 16) | (bytes[start + 3] << 24)

    let offset = 8
    const ownerPubkey = new PublicKey(dataToParse.slice(offset, offset + 32))
    offset += 32
    const inactivityPeriod = Number(readI64(dataToParse, offset))
    offset += 8
    const lastActivity = Number(readI64(dataToParse, offset))
    offset += 8
    const intentDataLength = readU32(dataToParse, offset)
    offset += 4
    const intentDataBytes = dataToParse.slice(offset, offset + intentDataLength)
    offset += intentDataLength
    const isActive = dataToParse[offset] === 1
    offset += 1
    let executedAt: number | null = null
    if (dataToParse[offset] === 1) {
      offset += 1
      executedAt = Number(readI64(dataToParse, offset))
      offset += 8
    }

    // @ts-ignore
    const result = {
      owner: ownerPubkey,
      inactivityPeriod,
      lastActivity,
      intentData: new Uint8Array(intentDataBytes),
      isActive,
      executedAt,
      capsuleAddress: capsulePda.toBase58(),
      accountOwner: accountInfo.owner,
      mint: undefined,
    }

    // Skip bump (1) and vault_bump (1)
    offset += 2
    if (offset + 32 <= dataToParse.length) {
      // @ts-ignore
      result.mint = new PublicKey(dataToParse.slice(offset, offset + 32))
    }
    return result as IntentCapsule & { capsuleAddress: string }
  } catch {
    return null
  }
}

/**
 * Undelegate capsule and vault from Ephemeral Rollup back to Solana base layer.
 * Uses the MagicBlock Permission Program's CommitAndUndelegatePermission instruction
 * (discriminator = 5 as borsh u64 LE) which commits ER state and undelegates the account.
 */
export async function undelegateCapsule(
  wallet: WalletContextState,
  ownerPublicKey?: PublicKey
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected')

  const ownerKey = ownerPublicKey ?? wallet.publicKey
  const [capsulePDA] = getCapsulePDA(ownerKey)
  const [vaultPDA] = getCapsuleVaultPDA(ownerKey)

  const magicProgramId = new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID)
  const magicContextId = new PublicKey(MAGICBLOCK_ER.MAGIC_CONTEXT)
  const programId = getProgramId()

  debugLog('[undelegateCapsule] Committing and undelegating from ER via crank_undelegate...')
  debugLog(' - Capsule:', capsulePDA.toBase58())
  debugLog(' - Vault:', vaultPDA.toBase58())

  // Use our program's crank_undelegate instruction — does CPI to Magic program
  // so it provides proper parent program ID context.
  const crankUndelegateDisc = idl.instructions?.find(
    (i: any) => i.name === 'crank_undelegate' || i.name === 'crankUndelegate'
  )?.discriminator as number[] | undefined
  if (!crankUndelegateDisc) throw new Error('crank_undelegate instruction not found in IDL')

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },   // payer
      { pubkey: capsulePDA, isSigner: false, isWritable: true },         // capsule
      { pubkey: vaultPDA, isSigner: false, isWritable: true },           // vault
      { pubkey: magicContextId, isSigner: false, isWritable: true },     // magic_context
      { pubkey: magicProgramId, isSigner: false, isWritable: false },    // magic_program
    ],
    programId,
    data: Buffer.from(crankUndelegateDisc),
  })

  const erConnection = new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
  const { blockhash, lastValidBlockHeight } = await erConnection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight })
  tx.add(ix)

  const signedTx = await wallet.signTransaction(tx)
  const txSig = await erConnection.sendRawTransaction(signedTx.serialize(), { skipPreflight: true })
  await erConnection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, 'confirmed')

  const baseConnection = getSolanaConnection()
  const waitForBaseProgramOwner = async (account: PublicKey, timeoutMs = 20_000): Promise<boolean> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const info = await baseConnection.getAccountInfo(account)
      if (info?.owner.equals(programId)) return true
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
    return false
  }

  const [capsuleReady, vaultReady] = await Promise.all([
    waitForBaseProgramOwner(capsulePDA),
    waitForBaseProgramOwner(vaultPDA),
  ])

  if (!capsuleReady || !vaultReady) {
    throw new Error(`Undelegation submitted but not yet visible on base layer (capsule=${capsuleReady}, vault=${vaultReady})`)
  }

  debugLog('[undelegateCapsule] Success. Tx:', txSig)
  return txSig
}

/**
 * Process undelegation for an account after commit from ER.
 * Called on the base layer to finalize the undelegation.
 */
export async function processUndelegation(
  wallet: WalletContextState,
  baseAccount: PublicKey,
  accountSeeds: Uint8Array[]
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const bufferSeedProgramId = new PublicKey(MAGICBLOCK_ER.BUFFER_SEED_PROGRAM_ID)
  const [bufferPDA] = getBufferPDA(baseAccount, bufferSeedProgramId)

  const accounts = {
    baseAccount: baseAccount,
    buffer: bufferPDA,
    payer: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  }

  const seedsBuffers = accountSeeds.map(s => Buffer.from(s))

  const tx = await program.methods
    .processUndelegation(seedsBuffers)
    // @ts-ignore
    .accounts(accounts)
    .rpc()

  debugLog('[processUndelegation] Success. Tx:', tx)
  return tx
}

/**
 * Cancel (close) a capsule, reclaiming SOL from vault and account rent.
 * Owner-only. Used to clear stuck capsules or simply close them.
 */
export async function cancelCapsule(
  wallet: WalletContextState
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(wallet.publicKey)
  const [vaultPDA] = getCapsuleVaultPDA(wallet.publicKey)

  const accounts = {
    capsule: capsulePDA,
    vault: vaultPDA,
    owner: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  }

  debugLog('[cancelCapsule] Cancelling capsule and reclaiming SOL...')

  const tx = await program.methods
    .cancelCapsule()
    // @ts-ignore
    .accounts(accounts)
    .rpc()

  debugLog('[cancelCapsule] Success. Tx:', tx)
  return tx
}

/**
 * Deactivate a capsule (owner can cancel before execution).
 * Marks capsule as inactive but does not close the account.
 */
export async function deactivateCapsule(
  wallet: WalletContextState
): Promise<string> {
  const program = getProgram(wallet)
  if (!program) throw new Error('Wallet not connected')
  if (!wallet.publicKey) throw new Error('Wallet not connected')

  const [capsulePDA] = getCapsulePDA(wallet.publicKey)

  const accounts = {
    capsule: capsulePDA,
    owner: wallet.publicKey,
  }

  debugLog('[deactivateCapsule] Deactivating capsule...')

  const tx = await program.methods
    .deactivateCapsule()
    // @ts-ignore
    .accounts(accounts)
    .rpc()

  debugLog('[deactivateCapsule] Success. Tx:', tx)
  return tx
}

// Re-export types
export type { IntentCapsule } from '@/types'

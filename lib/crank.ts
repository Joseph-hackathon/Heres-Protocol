import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor'
import idl from '../idl/HeresProgram.json'
import { getSolanaConnection } from '@/config/solana'
import { getCapsulePDA, getCapsuleVaultPDA, getFeeConfigPDA } from './program'
import { SOLANA_CONFIG, MAGICBLOCK_ER } from '@/constants'
import { getRegisteredOwners, unregisterCapsuleOwner } from '@/lib/capsule-registry'
import { fetchCapsuleStateByAddress, type DecodedCapsuleState } from '@/lib/cre/solana'
import { parseIntentData } from '@/lib/intentParser'
import { safePgQuery, isPostgresConfigured } from '@/lib/postgres'

const WalletClass = require('@coral-xyz/anchor').Wallet || (AnchorProvider.prototype as any).wallet

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

export type DecodedCapsule = {
  publicKey: PublicKey
  account: {
    owner: PublicKey
    inactivityPeriod: BN
    lastActivity: BN
    intentData: Buffer | Uint8Array
    isActive: boolean
    executedAt: BN | null
    mint: PublicKey
  }
}

function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
  )[0]
}

export async function getEligibleCapsules(connection: Connection, crankKeypair: Keypair): Promise<DecodedCapsule[]> {
  const wallet = new WalletClass(crankKeypair)
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  const program = new Program(idl as any, provider)

  // @ts-ignore
  const capsules = (await program.account.intentCapsule.all()) as any[]
  const now = Math.floor(Date.now() / 1000)
  const eligible: DecodedCapsule[] = []

  // Fetch active subscriptions in bulk if database is configured
  let activeSubscriptions = new Set<string>()
  if (isPostgresConfigured()) {
    try {
      const res = await safePgQuery<{ capsule_address: string }>(
        `SELECT capsule_address FROM capsule_subscriptions
         WHERE status = 'active'
           AND monitoring_enabled = TRUE
           AND (current_period_end > NOW() OR current_period_end IS NULL)`
      )
      if (res && res.rows) {
        activeSubscriptions = new Set(res.rows.map((r) => r.capsule_address))
      }
    } catch (err) {
      console.error('[Crank] Failed to fetch active subscriptions:', err)
    }
  }

  for (const capsule of capsules) {
    const data = capsule.account
    if (!data.isActive || data.executedAt != null) continue
    if (data.lastActivity.toNumber() + data.inactivityPeriod.toNumber() > now) continue

    const capsuleAddress = capsule.publicKey.toBase58()

    // Skip if monitoring subscription is not active (only when DB is configured)
    if (isPostgresConfigured() && !activeSubscriptions.has(capsuleAddress)) {
      continue
    }

    // Skip delegated capsules (they must be executed on the rollup)
    const accountInfo = await connection.getAccountInfo(capsule.publicKey)
    if (accountInfo && accountInfo.owner.toString() === 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh') {
      continue
    }

    eligible.push(capsule)
  }
  return eligible
}

function parseBeneficiaries(intentData: Buffer | Uint8Array): Array<{ address: string; amount: string; amountType: string }> {
  try {
    const json = new TextDecoder().decode(intentData)
    const data = JSON.parse(json) as { beneficiaries?: Array<{ address?: string; amount?: string; amountType?: string }> }
    const list = data?.beneficiaries
    if (!Array.isArray(list)) return []
    return list
      .filter((b) => b?.address)
      .map((b) => ({
        address: b.address!,
        amount: typeof b.amount === 'string' ? b.amount : String(b.amount ?? '0'),
        amountType: b.amountType ?? 'fixed',
      }))
  } catch {
    return []
  }
}

export async function executeCapsuleIntent(
  connection: Connection,
  crankKeypair: Keypair,
  capsule: DecodedCapsule
): Promise<string> {
  const wallet = new WalletClass(crankKeypair)
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  const program = new Program(idl as any, provider)

  const beneficiaries = parseBeneficiaries(capsule.account.intentData)
  if (beneficiaries.length === 0) throw new Error('No beneficiaries in intent data')

  const mint = capsule.account.mint
  const isSpl = mint && !mint.equals(PublicKey.default) && !mint.equals(SystemProgram.programId)

  const [capsulePDA] = getCapsulePDA(capsule.account.owner)
  const [vaultPDA] = getCapsuleVaultPDA(capsule.account.owner)
  const [feeConfigPDA] = getFeeConfigPDA()
  const platformFeeRecipient = new PublicKey(
    SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT || 'Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb'
  )

  let vaultTokenAccount = null
  if (isSpl) {
    vaultTokenAccount = getAssociatedTokenAddress(mint, vaultPDA)
  }

  const remainingAccounts = beneficiaries.map((b) => {
    const beneficiaryOwner = new PublicKey(b.address)
    if (isSpl) {
      return {
        pubkey: getAssociatedTokenAddress(mint, beneficiaryOwner),
        isSigner: false,
        isWritable: true,
      }
    } else {
      return {
        pubkey: beneficiaryOwner,
        isSigner: false,
        isWritable: true,
      }
    }
  })

  // @ts-ignore
  const tx = await program.methods
    .executeIntent()
    // @ts-ignore
    .accounts({
      capsule: capsulePDA,
      vault: vaultPDA,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      feeConfig: feeConfigPDA,
      platformFeeRecipient: platformFeeRecipient,
      vaultTokenAccount: vaultTokenAccount as any,
    } as any)
    .remainingAccounts(remainingAccounts)
    .rpc()

  return tx
}

export type CrankResult = {
  ok: boolean
  eligibleCount: number
  attemptedCount: number
  executedCount: number
  errors: string[]
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

export type RunCrankOptions = {
  maxExecutions?: number
}

export async function runCrank(crankKeypair: Keypair, options: RunCrankOptions = {}): Promise<CrankResult> {
  const connection = getSolanaConnection()
  const eligible = await getEligibleCapsules(connection, crankKeypair)
  const errors: string[] = []
  const maxExecutions =
    typeof options.maxExecutions === 'number' && Number.isFinite(options.maxExecutions) && options.maxExecutions > 0
      ? Math.floor(options.maxExecutions)
      : eligible.length
  let attemptedCount = 0
  let executedCount = 0

  for (const capsule of eligible) {
    if (attemptedCount >= maxExecutions) break
    attemptedCount += 1

    try {
      await executeCapsuleIntent(connection, crankKeypair, capsule)
      executedCount += 1
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${capsule.publicKey.toBase58()}: ${msg}`)
    }
  }

  return {
    ok: errors.length === 0,
    eligibleCount: eligible.length,
    attemptedCount,
    executedCount,
    errors,
  }
}

export type AutomationStepResult = {
  ok: boolean
  attemptedCount: number
  successCount: number
  errors: string[]
}

async function getRegisteredCapsules(): Promise<Array<{ owner: PublicKey; capsulePDA: PublicKey; state: DecodedCapsuleState }>> {
  const owners = await getRegisteredOwners()
  const capsules: Array<{ owner: PublicKey; capsulePDA: PublicKey; state: DecodedCapsuleState }> = []

  for (const ownerBase58 of owners) {
    try {
      const owner = new PublicKey(ownerBase58)
      const [capsulePDA] = getCapsulePDA(owner)
      const state = await fetchCapsuleStateByAddress(capsulePDA)
      if (state) capsules.push({ owner, capsulePDA, state })
    } catch {
      // Ignore bad registry entries; registration validates new entries.
    }
  }

  return capsules
}

export async function undelegateExecutedCapsules(
  crankKeypair: Keypair,
  maxUndelegations = 1
): Promise<AutomationStepResult> {
  const capsules = await getRegisteredCapsules()
  const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
  const erConnection = new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
  const programId = getProgramIdFromIdl()
  const errors: string[] = []
  let attemptedCount = 0
  let successCount = 0

  for (const capsule of capsules) {
    if (attemptedCount >= maxUndelegations) break
    if (!capsule.state.accountOwner.equals(delegationProgramId)) continue
    if (capsule.state.executedAt === null) continue

    attemptedCount += 1
    try {
      const [vaultPDA] = getCapsuleVaultPDA(capsule.owner)
      const crankUndelegateDisc = (idl as any).instructions?.find(
        (instruction: any) => instruction.name === 'crank_undelegate' || instruction.name === 'crankUndelegate'
      )?.discriminator as number[] | undefined
      if (!crankUndelegateDisc) throw new Error('crank_undelegate instruction not found in IDL')

      const ix = new TransactionInstruction({
        keys: [
          { pubkey: crankKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: capsule.capsulePDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: new PublicKey(MAGICBLOCK_ER.MAGIC_CONTEXT), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID), isSigner: false, isWritable: false },
        ],
        programId,
        data: Buffer.from(crankUndelegateDisc),
      })

      const { blockhash, lastValidBlockHeight } = await erConnection.getLatestBlockhash('confirmed')
      const tx = new Transaction({ feePayer: crankKeypair.publicKey, blockhash, lastValidBlockHeight }).add(ix)
      tx.sign(crankKeypair)
      const signature = await erConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true })
      await erConnection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
      successCount += 1
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${capsule.capsulePDA.toBase58()}: ${msg}`)
    }
  }

  return { ok: errors.length === 0, attemptedCount, successCount, errors }
}

function getProgramIdFromIdl(): PublicKey {
  const address = (idl as any).address || SOLANA_CONFIG.PROGRAM_ID
  return new PublicKey(address)
}

async function hasDistributableBalance(connection: Connection, state: DecodedCapsuleState, vaultPDA: PublicKey): Promise<boolean> {
  const isSpl = !state.mint.equals(PublicKey.default) && !state.mint.equals(SystemProgram.programId)
  if (!isSpl) {
    const balance = await connection.getBalance(vaultPDA)
    return balance > 0
  }

  const vaultTokenAccount = getAssociatedTokenAddress(state.mint, vaultPDA)
  const balance = await connection.getTokenAccountBalance(vaultTokenAccount).catch(() => null)
  return BigInt(balance?.value.amount || '0') > 0n
}

async function distributeCapsuleAssets(
  connection: Connection,
  crankKeypair: Keypair,
  state: DecodedCapsuleState
): Promise<string> {
  const intent = parseIntentData(state.intentData)
  if (!intent || intent.beneficiaries.length === 0) throw new Error('No beneficiaries in intent data')

  const capsulePDA = new PublicKey(state.capsuleAddress)
  const [vaultPDA] = getCapsuleVaultPDA(state.owner)
  const [feeConfigPDA] = getFeeConfigPDA()
  const programId = getProgramIdFromIdl()
  const isSpl = !state.mint.equals(PublicKey.default) && !state.mint.equals(SystemProgram.programId)

  let feeRecipient = SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT
    ? new PublicKey(SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT)
    : new PublicKey('Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb')
  try {
    const feeInfo = await connection.getAccountInfo(feeConfigPDA)
    if (feeInfo) {
      const { BorshAccountsCoder } = await import('@coral-xyz/anchor')
      const coder = new BorshAccountsCoder(idl as any)
      const feeData = coder.decode('FeeConfig', feeInfo.data)
      feeRecipient = new PublicKey(feeData.fee_recipient ?? feeData.feeRecipient)
    }
  } catch {
    // Keep configured fallback fee recipient.
  }

  const preInstructions: TransactionInstruction[] = []
  const feeRecipientAccount = isSpl ? getAssociatedTokenAddress(state.mint, feeRecipient) : feeRecipient
  if (isSpl) {
    const feeAtaInfo = await connection.getAccountInfo(feeRecipientAccount)
    if (!feeAtaInfo) {
      preInstructions.push(
        buildCreateAssociatedTokenAccountInstruction(crankKeypair.publicKey, feeRecipientAccount, feeRecipient, state.mint)
      )
    }
  }

  const remainingAccounts: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }> = []
  for (const beneficiary of intent.beneficiaries) {
    if ((beneficiary.chain ?? 'solana') !== 'solana') continue
    const beneficiaryOwner = new PublicKey(beneficiary.address)
    if (isSpl) {
      const beneficiaryAta = getAssociatedTokenAddress(state.mint, beneficiaryOwner)
      const beneficiaryAtaInfo = await connection.getAccountInfo(beneficiaryAta)
      if (!beneficiaryAtaInfo) {
        preInstructions.push(
          buildCreateAssociatedTokenAccountInstruction(
            crankKeypair.publicKey,
            beneficiaryAta,
            beneficiaryOwner,
            state.mint
          )
        )
      }
      remainingAccounts.push({ pubkey: beneficiaryAta, isSigner: false, isWritable: true })
    } else {
      remainingAccounts.push({ pubkey: beneficiaryOwner, isSigner: false, isWritable: true })
    }
  }

  const discriminator = Buffer.from([239, 241, 19, 219, 144, 191, 154, 18])
  const keys = [
    { pubkey: capsulePDA, isSigner: false, isWritable: false },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: feeConfigPDA, isSigner: false, isWritable: false },
    { pubkey: feeRecipientAccount, isSigner: false, isWritable: true },
    { pubkey: isSpl ? state.mint : programId, isSigner: false, isWritable: false },
    { pubkey: isSpl ? getAssociatedTokenAddress(state.mint, vaultPDA) : programId, isSigner: false, isWritable: isSpl },
    ...remainingAccounts,
  ]

  const ix = new TransactionInstruction({ keys, programId, data: discriminator })
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: crankKeypair.publicKey, blockhash, lastValidBlockHeight })
  preInstructions.forEach((instruction) => tx.add(instruction))
  tx.add(ix)
  tx.sign(crankKeypair)
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true })
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return signature
}

export async function distributeExecutedCapsules(
  crankKeypair: Keypair,
  maxDistributions = 1
): Promise<AutomationStepResult> {
  const connection = getSolanaConnection()
  const capsules = await getRegisteredCapsules()
  const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
  const errors: string[] = []
  let attemptedCount = 0
  let successCount = 0

  for (const capsule of capsules) {
    if (attemptedCount >= maxDistributions) break
    if (capsule.state.executedAt === null || capsule.state.isActive) continue
    if (capsule.state.accountOwner.equals(delegationProgramId)) continue

    const intent = parseIntentData(capsule.state.intentData)
    const isPrivateSpl =
      intent?.distributionMode === 'private' &&
      !capsule.state.mint.equals(PublicKey.default) &&
      !capsule.state.mint.equals(SystemProgram.programId)
    if (isPrivateSpl) continue

    const [vaultPDA] = getCapsuleVaultPDA(capsule.owner)
    if (!(await hasDistributableBalance(connection, capsule.state, vaultPDA))) {
      await unregisterCapsuleOwner(capsule.owner.toBase58())
      continue
    }

    attemptedCount += 1
    try {
      await distributeCapsuleAssets(connection, crankKeypair, capsule.state)
      await unregisterCapsuleOwner(capsule.owner.toBase58())
      successCount += 1
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${capsule.capsulePDA.toBase58()}: ${msg}`)
    }
  }

  return { ok: errors.length === 0, attemptedCount, successCount, errors }
}

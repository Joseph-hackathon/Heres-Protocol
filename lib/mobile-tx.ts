import { AnchorProvider, BN, Program } from '@coral-xyz/anchor'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import idl from '@/idl/heres_program.json'
import { getProgramId, getSolanaConnection } from '@/config/solana'
import { SOLANA_CONFIG } from '@/constants'
import { getCapsulePDA, getCapsuleVaultPDA, getFeeConfigPDA } from '@/lib/program'
import { encodeIntentData, daysToSeconds } from '@/utils/intent'
import { isValidAmountString } from '@/lib/assets'
import type { Beneficiary } from '@/types'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

type DummyWallet = {
  publicKey: PublicKey
  signTransaction: (tx: Transaction) => Promise<Transaction>
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>
}

function getDummyWallet(publicKey: PublicKey): DummyWallet {
  return {
    publicKey,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
  }
}

function getProgramForOwner(owner: PublicKey): Program {
  const connection = getSolanaConnection()
  const provider = new AnchorProvider(connection, getDummyWallet(owner) as any, { commitment: 'confirmed' })
  const programId = getProgramId()

  const programIdl = JSON.parse(JSON.stringify(idl))
  programIdl.address = programId.toBase58()

  return new Program(programIdl as any, provider)
}

function txToBase64(tx: Transaction): string {
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  return Buffer.from(bytes).toString('base64')
}

export type CreateCapsuleTxInput = {
  owner: string
  totalSol: string
  inactivityDays: number
  beneficiaryAddress: string
  beneficiaryAmountSol: string
  intent?: string
}

export async function buildCreateCapsuleUnsignedTx(input: CreateCapsuleTxInput): Promise<{
  transactionBase64: string
  capsuleAddress: string
  inactivitySeconds: number
}> {
  const owner = new PublicKey(input.owner)
  const beneficiaryAddress = new PublicKey(input.beneficiaryAddress)

  // Keep the exact user-typed strings; String(Number) can emit scientific notation (e.g. "1e-7")
  // that the on-chain parser rejects (audit M1). Validate the raw strings, not round-tripped numbers.
  const totalSolStr = input.totalSol.trim()
  const beneficiaryAmountStr = input.beneficiaryAmountSol.trim()
  const totalSolNum = Number.parseFloat(totalSolStr)
  const beneficiaryAmountNum = Number.parseFloat(beneficiaryAmountStr)
  const inactivitySeconds = daysToSeconds(input.inactivityDays)

  if (!isValidAmountString(totalSolStr) || !Number.isFinite(totalSolNum) || totalSolNum <= 0) {
    throw new Error('Invalid totalSol')
  }
  if (!isValidAmountString(beneficiaryAmountStr) || !Number.isFinite(beneficiaryAmountNum) || beneficiaryAmountNum <= 0) {
    throw new Error('Invalid beneficiaryAmountSol')
  }
  if (!Number.isFinite(inactivitySeconds) || inactivitySeconds <= 0) {
    throw new Error('Invalid inactivityDays')
  }

  const beneficiaries: Beneficiary[] = [
    {
      chain: 'solana',
      address: beneficiaryAddress.toBase58(),
      amount: beneficiaryAmountStr,
      amountType: 'fixed',
    },
  ]

  const intentData = encodeIntentData({
    intent: input.intent || 'Mobile capsule',
    beneficiaries,
    totalAmount: totalSolStr,
    inactivityDays: input.inactivityDays,
    delayDays: 0,
  })

  const program = getProgramForOwner(owner)
  const programId = getProgramId()
  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const [feeConfigPDA] = getFeeConfigPDA()

  const platformFeeRecipient = SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT
    ? new PublicKey(SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT)
    : owner

  const ix = await program.methods
    .createCapsule(new BN(inactivitySeconds), Buffer.from(intentData))
    .accountsStrict({
      capsule: capsulePDA,
      vault: vaultPDA,
      owner,
      feeConfig: feeConfigPDA,
      platformFeeRecipient,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      // Anchor optional-account sentinel for "None".
      mint: programId,
      sourceTokenAccount: programId,
      vaultTokenAccount: programId,
      associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
    } as any)
    .instruction()

  const connection = getSolanaConnection()
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')

  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight })
  tx.add(ix)

  return {
    transactionBase64: txToBase64(tx),
    capsuleAddress: capsulePDA.toBase58(),
    inactivitySeconds,
  }
}

export async function buildUpdateActivityUnsignedTx(ownerBase58: string): Promise<{
  transactionBase64: string
  capsuleAddress: string
}> {
  const owner = new PublicKey(ownerBase58)
  const program = getProgramForOwner(owner)
  const [capsulePDA] = getCapsulePDA(owner)

  const ix = await program.methods
    .updateActivity()
    .accounts({
      capsule: capsulePDA,
      owner,
    })
    .instruction()

  const connection = getSolanaConnection()
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')

  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight })
  tx.add(ix)

  return {
    transactionBase64: txToBase64(tx),
    capsuleAddress: capsulePDA.toBase58(),
  }
}

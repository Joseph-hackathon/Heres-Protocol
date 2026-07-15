import { AnchorProvider, BN, Program } from '@coral-xyz/anchor'
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import idl from '@/idl/heres_program.json'
import { getProgramId, getSolanaConnection } from '@/config/solana'
import { SOLANA_CONFIG } from '@/constants'
import { getCapsulePDA, getCapsuleVaultPDA, getBeneficiarySetPDA, getFeeConfigPDA, getRelayerPubkey } from '@/lib/program'
import { daysToSeconds } from '@/utils/intent'
import { isValidAmountString } from '@/lib/assets'
import {
  createInheritanceCommitment,
  createInheritanceSalt,
} from '@/lib/inheritance-commitment'

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

  const lamports = Math.round(totalSolNum * LAMPORTS_PER_SOL)

  const program = getProgramForOwner(owner)
  const [capsulePDA] = getCapsulePDA(owner)
  const [beneficiarySetPDA] = getBeneficiarySetPDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const [feeConfigPDA] = getFeeConfigPDA()

  const platformFeeRecipient = SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT
    ? new PublicKey(SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT)
    : owner

  // Base-layer fallback in one transaction: create the draft, set the single beneficiary, fund the
  // Vault, seal the configuration, and arm the Switch. NOTE: this mobile path is still
  // base-only - it does NOT delegate to the TEE, so the single beneficiary is set on the public base
  // layer (known gap: gate or rework to the multi-step TEE flow before mobile ships).
  const createIx = await program.methods
    // Mobile path is inactivity-only for now (no target-date UI); pass null = no absolute trigger.
    .createCapsule(new BN(inactivitySeconds), getRelayerPubkey(), null)
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

  const updateIntentIx = await program.methods
    .updateIntent([{ pubkey: beneficiaryAddress, shareBps: 10000, reserved: Array(14).fill(0) }])
    .accountsPartial({ beneficiarySet: beneficiarySetPDA, owner })
    .instruction()

  const beneficiaries = [{ pubkey: beneficiaryAddress, shareBps: 10000 }]
  const configSalt = createInheritanceSalt()
  const configCommitment = await createInheritanceCommitment(owner, beneficiaries, [], configSalt)
  const sealIx = await program.methods
    .sealInheritance(Array.from(configSalt), Array.from(configCommitment))
    .accountsPartial({ beneficiarySet: beneficiarySetPDA, owner })
    .instruction()
  const armIx = await program.methods
    .armCapsule(Array.from(configCommitment))
    .accountsPartial({ capsule: capsulePDA, owner })
    .instruction()

  const depositIx = await program.methods
    .deposit(new BN(lamports))
    .accountsPartial({
      capsule: capsulePDA,
      vault: vaultPDA,
      owner,
      systemProgram: SystemProgram.programId,
      tokenProgram: null,
      associatedTokenProgram: null,
      mint: null,
      sourceTokenAccount: null,
      vaultTokenAccount: null,
    } as any)
    .instruction()

  const connection = getSolanaConnection()
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')

  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight })
  tx.add(createIx, updateIntentIx, depositIx, sealIx, armIx)

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
    .accountsPartial({
      capsule: capsulePDA,
      authority: owner,
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

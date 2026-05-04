import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor'
// Use a local Wallet helper if @coral-xyz/anchor Wallet export fails
import type { Wallet } from '@coral-xyz/anchor'
const WalletClass = (require('@coral-xyz/anchor').Wallet || (AnchorProvider.prototype as any).wallet)
import idl from '../idl/HeresProgram.json'
import { getSolanaConnection, getProgramId } from '@/config/solana'
import { getCapsulePDA, getCapsuleVaultPDA, getFeeConfigPDA } from './program'
import { SOLANA_CONFIG } from '@/constants'

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

  for (const capsule of capsules) {
    const data = capsule.account
    if (!data.isActive || data.executedAt != null) continue
    if (data.lastActivity.toNumber() + data.inactivityPeriod.toNumber() > now) continue

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
  executedCount: number
  errors: string[]
}

export async function runCrank(crankKeypair: Keypair): Promise<CrankResult> {
  const connection = getSolanaConnection()
  const eligible = await getEligibleCapsules(connection, crankKeypair)
  const errors: string[] = []
  let executedCount = 0

  for (const capsule of eligible) {
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
    executedCount,
    errors,
  }
}

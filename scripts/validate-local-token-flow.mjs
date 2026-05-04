import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import anchor from '@coral-xyz/anchor'

const { AnchorProvider, Program, Wallet, BN, BorshAccountsCoder } = anchor

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

function keypairFromFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  return Keypair.fromSecretKey(Uint8Array.from(raw))
}

function capsulePda(owner, programId) {
  return PublicKey.findProgramAddressSync([Buffer.from('intent_capsule'), owner.toBuffer()], programId)[0]
}

function vaultPda(owner, programId) {
  return PublicKey.findProgramAddressSync([Buffer.from('capsule_vault'), owner.toBuffer()], programId)[0]
}

function feeConfigPda(programId) {
  return PublicKey.findProgramAddressSync([Buffer.from('fee_config')], programId)[0]
}

function permissionPda(capsule, permissionProgramId) {
  return PublicKey.findProgramAddressSync([Buffer.from('permission'), capsule.toBuffer()], permissionProgramId)[0]
}

async function ensureAta(connection, payer, mint, owner) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
  const info = await connection.getAccountInfo(ata)
  if (!info) {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          ata,
          owner,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      ),
      [payer]
    )
  }
  return ata
}

async function createMint(connection, payer, decimals) {
  const mint = Keypair.generate()
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE)
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint.publicKey, decimals, payer.publicKey, null, TOKEN_PROGRAM_ID)
  )
  await sendAndConfirmTransaction(connection, tx, [payer, mint])
  return mint.publicKey
}

async function tokenAmount(connection, ata) {
  const account = await getAccount(connection, ata)
  return Number(account.amount)
}

async function main() {
  loadEnv()

  const programId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || 'AmiL7vEZ2SpAuDXzdxC3sJMyjZqgacvwvvQdT3qosmsW')
  const permissionProgramId = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1')
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed')
  const authority = keypairFromFile(path.join(os.homedir(), '.config/solana/id.json'))

  const idl = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'idl', 'heres_program.json'), 'utf8'))
  idl.address = programId.toBase58()
  const coder = new BorshAccountsCoder(idl)
  const authorityProvider = new AnchorProvider(connection, new Wallet(authority), { commitment: 'confirmed' })
  const authorityProgram = new Program(idl, authorityProvider)

  await connection.requestAirdrop(authority.publicKey, 20 * LAMPORTS_PER_SOL)
  await new Promise((resolve) => setTimeout(resolve, 1000))

  const feeConfig = feeConfigPda(programId)
  const feeInfo = await connection.getAccountInfo(feeConfig)
  if (!feeInfo) {
    await authorityProgram.methods
      .initFeeConfig(authority.publicKey, new BN(0), 300)
      .accounts({
        feeConfig,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
  }

  const assets = ['BTC', 'ETH']
  let failures = 0

  for (const symbol of assets) {
    console.log(`\n=== Local ${symbol} E2E ===`)
    const mint = await createMint(connection, authority, 8)
    const owner = Keypair.generate()
    const beneficiary = Keypair.generate()
    const ownerProvider = new AnchorProvider(connection, new Wallet(owner), { commitment: 'confirmed' })
    const ownerProgram = new Program(idl, ownerProvider)

    await connection.requestAirdrop(owner.publicKey, 2 * LAMPORTS_PER_SOL)
    await new Promise((resolve) => setTimeout(resolve, 500))

    const ownerAta = await ensureAta(connection, authority, mint, owner.publicKey)
    const beneficiaryAta = await ensureAta(connection, authority, mint, beneficiary.publicKey)
    const platformFeeAta = await ensureAta(connection, authority, mint, authority.publicKey)
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(createMintToInstruction(mint, ownerAta, authority.publicKey, 150_000_000n)),
      [authority]
    )

    const capsule = capsulePda(owner.publicKey, programId)
    const vault = vaultPda(owner.publicKey, programId)
    const vaultAta = getAssociatedTokenAddressSync(mint, vault, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const permission = permissionPda(capsule, permissionProgramId)

    const intent = JSON.stringify({
      intent: `${symbol} local e2e`,
      beneficiaries: [{ chain: 'solana', address: beneficiary.publicKey.toBase58(), amount: '1.25', amountType: 'fixed' }],
      totalAmount: '1.25',
      assetSymbol: symbol,
      assetMint: mint.toBase58(),
      inactivityDays: 0,
      delayDays: 0,
    })

    await ownerProgram.methods
      .createCapsule(new BN(0), Buffer.from(intent))
      .accountsStrict({
        capsule,
        vault,
        owner: owner.publicKey,
        feeConfig,
        platformFeeRecipient: authority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        mint,
        sourceTokenAccount: ownerAta,
        vaultTokenAccount: vaultAta,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc()

    const executeIx = new TransactionInstruction({
      keys: [
        { pubkey: capsule, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: permissionProgramId, isSigner: false, isWritable: false },
        { pubkey: permission, isSigner: false, isWritable: false },
      ],
      programId,
      data: Buffer.from([53, 130, 47, 154, 227, 220, 122, 212]),
    })
    await sendAndConfirmTransaction(connection, new Transaction().add(executeIx), [authority])

    const beforeBeneficiary = await tokenAmount(connection, beneficiaryAta)
    const beforeFee = await tokenAmount(connection, platformFeeAta)

    const distributeIx = new TransactionInstruction({
      keys: [
        { pubkey: capsule, isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: feeConfig, isSigner: false, isWritable: false },
        { pubkey: platformFeeAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: beneficiaryAta, isSigner: false, isWritable: true },
      ],
      programId,
      data: Buffer.from([239, 241, 19, 219, 144, 191, 154, 18]),
    })
    await sendAndConfirmTransaction(connection, new Transaction().add(distributeIx), [authority])

    const afterBeneficiary = await tokenAmount(connection, beneficiaryAta)
    const afterFee = await tokenAmount(connection, platformFeeAta)
    const afterVault = await tokenAmount(connection, vaultAta)

    const capsuleInfo = await connection.getAccountInfo(capsule)
    const capsuleData = coder.decode('IntentCapsule', capsuleInfo.data)
    const executedAt = capsuleData.executed_at ?? capsuleData.executedAt
    const isActive = capsuleData.is_active ?? capsuleData.isActive

    const beneficiaryDelta = afterBeneficiary - beforeBeneficiary
    const feeDelta = afterFee - beforeFee
    const beneficiaryExpected = 121_250_000
    const feeExpected = 3_750_000

    const ok =
      beneficiaryDelta === beneficiaryExpected &&
      feeDelta === feeExpected &&
      afterVault === 0 &&
      Number(executedAt) > 0 &&
      isActive === false

    console.log(`beneficiaryDelta=${beneficiaryDelta} feeDelta=${feeDelta} vault=${afterVault}`)
    if (!ok) {
      failures += 1
      console.log(`[FAIL] ${symbol}`)
    } else {
      console.log(`[PASS] ${symbol}`)
    }
  }

  if (failures > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

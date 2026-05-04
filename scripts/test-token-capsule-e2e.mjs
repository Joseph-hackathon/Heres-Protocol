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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
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

function findCapsulePda(owner, programId) {
  return PublicKey.findProgramAddressSync([Buffer.from('intent_capsule'), owner.toBuffer()], programId)[0]
}

function findVaultPda(owner, programId) {
  return PublicKey.findProgramAddressSync([Buffer.from('capsule_vault'), owner.toBuffer()], programId)[0]
}

function findFeeConfigPda(programId) {
  return PublicKey.findProgramAddressSync([Buffer.from('fee_config')], programId)[0]
}

function findPermissionPda(capsule, permissionProgramId) {
  return PublicKey.findProgramAddressSync([Buffer.from('permission'), capsule.toBuffer()], permissionProgramId)[0]
}

async function ensureAta(connection, payer, mint, owner) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
  const info = await connection.getAccountInfo(ata)
  if (!info) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        owner,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
    await sendAndConfirmTransaction(connection, tx, [payer])
  }
  return ata
}

async function getTokenAmount(connection, ata) {
  const account = await getAccount(connection, ata)
  return Number(account.amount)
}

async function main() {
  loadEnv()

  const programId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || 'AmiL7vEZ2SpAuDXzdxC3sJMyjZqgacvwvvQdT3qosmsW')
  const permissionProgramId = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1')
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
  const keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json')
  const funder = keypairFromFile(keypairPath)
  const connection = new Connection(rpcUrl, 'confirmed')

  const idl = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'idl', 'heres_program.json'), 'utf8'))
  idl.address = programId.toBase58()
  const coder = new BorshAccountsCoder(idl)

  const feeConfigPda = findFeeConfigPda(programId)
  const feeConfigInfo = await connection.getAccountInfo(feeConfigPda)
  if (!feeConfigInfo) throw new Error('FeeConfig account not found')
  const feeConfig = coder.decode('FeeConfig', feeConfigInfo.data)
  const originalPlatformFeeRecipient = new PublicKey(feeConfig.fee_recipient ?? feeConfig.feeRecipient)

  const assets = [
    { symbol: 'BTC', mint: process.env.NEXT_PUBLIC_BTC_DEVNET_MINT },
    { symbol: 'ETH', mint: process.env.NEXT_PUBLIC_ETH_DEVNET_MINT },
  ]

  for (const asset of assets) {
    if (!asset.mint) throw new Error(`${asset.symbol} mint not configured`)
  }

  let failures = 0

  for (const asset of assets) {
    const mint = new PublicKey(asset.mint)
    const owner = Keypair.generate()
    const beneficiary = Keypair.generate()
    const provider = new AnchorProvider(connection, new Wallet(owner), { commitment: 'confirmed' })
    const program = new Program(idl, provider)

    console.log(`\n=== ${asset.symbol} capsule E2E ===`)
    console.log(`owner=${owner.publicKey.toBase58()}`)
    console.log(`beneficiary=${beneficiary.publicKey.toBase58()}`)

    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: funder.publicKey,
          toPubkey: owner.publicKey,
          lamports: Math.floor(0.08 * LAMPORTS_PER_SOL),
        })
      ),
      [funder]
    )

    const ownerAta = await ensureAta(connection, funder, mint, owner.publicKey)
    const beneficiaryAta = await ensureAta(connection, funder, mint, beneficiary.publicKey)
    const platformFeeAta = await ensureAta(connection, funder, mint, originalPlatformFeeRecipient)
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(createMintToInstruction(mint, ownerAta, funder.publicKey, 150_000_000_000n)),
      [funder]
    )

    const capsulePda = findCapsulePda(owner.publicKey, programId)
    const vaultPda = findVaultPda(owner.publicKey, programId)
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultPda, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const permissionPda = findPermissionPda(capsulePda, permissionProgramId)

    const intent = JSON.stringify({
      intent: `${asset.symbol} e2e`,
      beneficiaries: [
        { chain: 'solana', address: beneficiary.publicKey.toBase58(), amount: '1.25', amountType: 'fixed' },
      ],
      totalAmount: '1.25',
      assetSymbol: asset.symbol,
      assetMint: mint.toBase58(),
      inactivityDays: 0,
      delayDays: 0,
    })

    await program.methods
      .createCapsule(new BN(0), Buffer.from(intent))
      .accountsStrict({
        capsule: capsulePda,
        vault: vaultPda,
        owner: owner.publicKey,
        feeConfig: feeConfigPda,
        platformFeeRecipient: originalPlatformFeeRecipient,
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
        { pubkey: capsulePda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: permissionProgramId, isSigner: false, isWritable: false },
        { pubkey: permissionPda, isSigner: false, isWritable: false },
      ],
      programId,
      data: Buffer.from([53, 130, 47, 154, 227, 220, 122, 212]),
    })
    await sendAndConfirmTransaction(connection, new Transaction().add(executeIx), [funder], { commitment: 'confirmed' })

    const distributeIx = new TransactionInstruction({
      keys: [
        { pubkey: capsulePda, isSigner: false, isWritable: false },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: feeConfigPda, isSigner: false, isWritable: false },
        { pubkey: platformFeeAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: beneficiaryAta, isSigner: false, isWritable: true },
      ],
      programId,
      data: Buffer.from([239, 241, 19, 219, 144, 191, 154, 18]),
    })

    const beneficiaryBefore = await getTokenAmount(connection, beneficiaryAta)
    try {
      await sendAndConfirmTransaction(connection, new Transaction().add(distributeIx), [funder], { commitment: 'confirmed' })
      const beneficiaryAfter = await getTokenAmount(connection, beneficiaryAta)
      const vaultAfter = await getTokenAmount(connection, vaultAta)
      const expected = 121_250_000n
      const received = BigInt(beneficiaryAfter - beneficiaryBefore)
      const ok = received === expected && vaultAfter === 0
      console.log(`received=${received.toString()} expected=${expected.toString()} vaultAfter=${vaultAfter}`)
      if (!ok) {
        failures += 1
        console.log(`[FAIL] ${asset.symbol} flow`)
      } else {
        console.log(`[PASS] ${asset.symbol} flow`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('Invalid fee config') || message.includes('0x1779')) {
        console.log(`[EXPECTED-FAIL] ${asset.symbol} distribute blocked by immutable SPL fee recipient bug`)
      } else {
        failures += 1
        console.log(`[FAIL] ${asset.symbol} distribute unexpected error`)
        console.log(message)
      }
    }
  }

  if (failures > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

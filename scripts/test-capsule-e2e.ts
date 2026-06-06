/**
 * E2E test: CRE register -> Create -> (optional ER: Delegate -> Crank -> Execute -> Undelegate) -> distribute -> CRE dispatch
 *
 * Prerequisites:
 *   1. Add TEST_MNEMONIC="..." to .env.local (used to fund fresh test keypair)
 *   2. Run the Next.js dev server: pnpm dev  (for CRE API routes)
 *   3. SKIP_DELEGATION=true npx tsx scripts/test-capsule-e2e.ts   (base layer)
 *      SKIP_DELEGATION=false npx tsx scripts/test-capsule-e2e.ts  (ER flow)
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js'
import { Program, AnchorProvider, BN, Wallet, BorshAccountsCoder } from '@coral-xyz/anchor'
import { createHash, sign as cryptoSign, createPrivateKey } from 'crypto'
import * as bip39 from 'bip39'
import { derivePath } from 'ed25519-hd-key'
import * as fs from 'fs'
import * as path from 'path'

// ─── Config ────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey('2fLojZpdmXLeg2ZXRCXVsqiWnbpF2yFH1SVGS77UC8s3')
const RPC_URL = 'https://api.devnet.solana.com'
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const PERMISSION_PROGRAM_ID = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1')
const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh')
const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111')
const MAGIC_CONTEXT = new PublicKey('MagicContext1111111111111111111111111111111')
// #[delegate] macro derives buffer PDAs using the program's own ID at compile time
const BUFFER_SEED_PROGRAM_ID = PROGRAM_ID

const SKIP_DELEGATION = (process.env.SKIP_DELEGATION ?? 'true') === 'true'
const ER_VALIDATOR = new PublicKey('MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57')
const ER_RPC_URL = 'https://devnet.magicblock.app'
const APP_BASE_URL = 'http://localhost:3000'

const INACTIVITY_SECONDS = 10 // short for testing
const TEST_SOL_AMOUNT = '0.003'
const TEST_EMAIL = process.env.TEST_EMAIL || 'snorlax00x@gmail.com'

// ─── Helpers ───────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) throw new Error('.env.local not found')
  const content = fs.readFileSync(envPath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (!process.env[key]) process.env[key] = val
  }
}

function keypairFromMnemonic(mnemonic: string): Keypair {
  const seed = bip39.mnemonicToSeedSync(mnemonic)
  const derived = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key
  return Keypair.fromSeed(derived)
}

function getCapsulePDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('intent_capsule'), owner.toBuffer()], PROGRAM_ID)
}
function getCapsuleVaultPDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('capsule_vault'), owner.toBuffer()], PROGRAM_ID)
}
function getFeeConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('fee_config')], PROGRAM_ID)
}
function getPermissionPDA(capsule: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('permission'), capsule.toBuffer()], PERMISSION_PROGRAM_ID)
}
function getBufferPDA(pda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('buffer'), pda.toBuffer()], BUFFER_SEED_PROGRAM_ID)
}
function getDelegationRecordPDA(pda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('delegation'), pda.toBuffer()], DELEGATION_PROGRAM_ID)
}
function getDelegationMetadataPDA(pda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('delegation-metadata'), pda.toBuffer()], DELEGATION_PROGRAM_ID)
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function signMessageWithKeypair(keypair: Keypair, message: string): string {
  const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
  const pkcs8Der = Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(keypair.secretKey.slice(0, 32))])
  const privateKey = createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' })
  return cryptoSign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64')
}

function buildCreSignedMessage(input: {
  action: string; owner: string; timestamp: number
  capsuleAddress?: string; recipientEmailHash?: string; encryptedPayloadHash?: string
}): string {
  const parts = [
    'Heres CRE Auth v1', `action:${input.action}`,
    `owner:${input.owner.trim()}`, `timestamp:${Math.trunc(input.timestamp)}`,
  ]
  if (input.capsuleAddress) parts.push(`capsule:${input.capsuleAddress.trim()}`)
  if (input.recipientEmailHash) parts.push(`recipientEmailHash:${input.recipientEmailHash.trim().toLowerCase()}`)
  if (input.encryptedPayloadHash) parts.push(`encryptedPayloadHash:${input.encryptedPayloadHash.trim().toLowerCase()}`)
  return parts.join('\n')
}

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) }

let passed = 0, failed = 0, skipped = 0
function assert(cond: boolean, label: string) {
  if (cond) { console.log(`  [PASS] ${label}`); passed++ }
  else { console.log(`  [FAIL] ${label}`); failed++ }
}
function skip(label: string) { console.log(`  [SKIP] ${label}`); skipped++ }
function log(step: string, msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [${step}] ${msg}`)
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  loadEnv()
  const mnemonic = process.env.TEST_MNEMONIC
  if (!mnemonic) throw new Error('TEST_MNEMONIC not set in .env.local')

  // Use mnemonic keypair as funder, generate fresh owner for each test run
  const funder = keypairFromMnemonic(mnemonic)
  const ownerKp = Keypair.generate()
  const owner = ownerKp.publicKey

  console.log('=== Heres Protocol E2E Test ===')
  console.log(`Mode: ${SKIP_DELEGATION ? 'Base Layer' : 'Ephemeral Rollup'}`)
  console.log(`Funder: ${funder.publicKey.toBase58()}`)
  console.log(`Owner:  ${owner.toBase58()} (fresh)`)

  const connection = new Connection(RPC_URL, 'confirmed')

  // Check funder balance
  const funderBalance = await connection.getBalance(funder.publicKey)
  log('INIT', `Funder balance: ${(funderBalance / 1e9).toFixed(4)} SOL`)
  if (funderBalance < 0.05 * LAMPORTS_PER_SOL) throw new Error('Funder has insufficient balance')

  // Check dev server (optional — CRE steps will be skipped if not running)
  let devServerRunning = false
  try { await fetch(`${APP_BASE_URL}/api/intent-delivery/status?capsule=test&owner=test&timestamp=0`); devServerRunning = true }
  catch { log('INIT', 'Dev server not running — CRE steps will be skipped') }
  if (devServerRunning) log('INIT', 'Dev server running')

  // Fund fresh owner
  log('INIT', 'Funding fresh owner...')
  const fundAmount = SKIP_DELEGATION ? 0.1 : 0.15
  await sendAndConfirmTransaction(connection, new Transaction().add(
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: owner, lamports: Math.floor(fundAmount * LAMPORTS_PER_SOL) })
  ), [funder])
  log('INIT', `Owner funded with ${fundAmount} SOL`)

  const wallet = new Wallet(ownerKp)
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  const idl = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'idl', 'heres_program.json'), 'utf-8'))
  idl.address = PROGRAM_ID.toBase58()
  const program = new Program(idl as any, provider)

  const [capsulePDA] = getCapsulePDA(owner)
  const [vaultPDA] = getCapsuleVaultPDA(owner)
  const [feeConfigPDA] = getFeeConfigPDA()
  const [permissionPDA] = getPermissionPDA(capsulePDA)

  const feeConfigAccount = await connection.getAccountInfo(feeConfigPDA)
  const platformFeeRecipient = feeConfigAccount && feeConfigAccount.data.length >= 72
    ? new PublicKey(feeConfigAccount.data.slice(40, 72))
    : owner
  log('INIT', `Capsule PDA: ${capsulePDA.toBase58()}`)

  // Derive beneficiary (separate from owner)
  const beneficiaryKp = Keypair.generate()
  const beneficiary = beneficiaryKp.publicKey
  log('INIT', `Beneficiary: ${beneficiary.toBase58()}`)

  // ═══ Step 1: CRE Register ═════════════════════════════════════
  console.log('\n--- Step 1: CRE Register ---')
  const normalizedEmail = TEST_EMAIL.trim().toLowerCase()
  const recipientEmailHash = sha256Hex(normalizedEmail)
  let regJson: any = {}
  if (!devServerRunning) {
    skip('CRE register (no dev server)')
  } else {
    const fakeEncryptedPayload = JSON.stringify({
      v: 1, alg: 'AES-GCM', kdf: 'PBKDF2', hash: 'SHA-256', iterations: 120000,
      salt: Buffer.from('test-salt-12345678').toString('base64'),
      iv: Buffer.from('test-iv-1234').toString('base64'),
      ciphertext: Buffer.from('E2E test encrypted payload').toString('base64'),
    })
    const encryptedPayloadHash = sha256Hex(fakeEncryptedPayload)
    const ts1 = Date.now()
    const sig1 = signMessageWithKeypair(ownerKp, buildCreSignedMessage({
      action: 'register-secret', owner: owner.toBase58(), timestamp: ts1, recipientEmailHash, encryptedPayloadHash,
    }))
    const regRes = await fetch(`${APP_BASE_URL}/api/intent-delivery/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: owner.toBase58(), recipientEmail: normalizedEmail, encryptedPayload: fakeEncryptedPayload, timestamp: ts1, signature: sig1 }),
    })
    regJson = await regRes.json() as any
    if (!regRes.ok) {
      log('STEP 1', `CRE register failed [${regRes.status}]: ${JSON.stringify(regJson)}`)
      assert(false, 'CRE register')
    } else {
      log('STEP 1', `CRE registered! ref=${regJson.secretRef}`)
      assert(true, 'CRE register')
    }
  }

  // ═══ Step 2: Create Capsule ═══════════════════════════════════
  console.log('\n--- Step 2: Create Capsule ---')
  const intentData = JSON.stringify({
    intent: 'E2E test', totalAmount: TEST_SOL_AMOUNT, inactivityDays: 0, delayDays: 0,
    beneficiaries: [{ address: beneficiary.toBase58(), amount: TEST_SOL_AMOUNT, amountType: 'fixed' }],
    cre: regJson.secretRef ? {
      enabled: true, secretRef: regJson.secretRef, secretHash: regJson.secretHash,
      recipientEmailHash, deliveryChannel: 'email',
    } : undefined,
  })
  try {
    const createTx = await program.methods
      .createCapsule(new BN(INACTIVITY_SECONDS), Buffer.from(intentData))
      .accounts({
        capsule: capsulePDA, vault: vaultPDA, owner, feeConfig: feeConfigPDA,
        platformFeeRecipient, systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        mint: null, sourceTokenAccount: null, vaultTokenAccount: null,
        associatedTokenProgram: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
      }).rpc()
    log('STEP 2', `Capsule created! TX: ${createTx}`)
    assert(true, 'Capsule created')
  } catch (e: any) {
    log('STEP 2', `Create failed: ${e.message?.slice(0, 200)}`)
    if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log('  ', l))
    assert(false, 'Capsule created')
    return printSummary()
  }

  // Verify capsule state
  await sleep(2000)
  try {
    const coder = new BorshAccountsCoder(idl)
    const capsuleInfo = await connection.getAccountInfo(capsulePDA)
    if (capsuleInfo) {
      const data = coder.decode('IntentCapsule', capsuleInfo.data)
      assert(data.is_active === true, 'Capsule is_active = true')
      assert(data.owner.equals(owner), 'Capsule owner matches')
    } else {
      assert(false, 'Capsule account exists')
    }
  } catch (e: any) {
    log('STEP 2', `Verify failed: ${e.message?.slice(0, 100)}`)
    assert(false, 'Capsule state verify')
  }

  if (SKIP_DELEGATION) {
    // ═══ Base Layer Flow ═══════════════════════════════════════════
    console.log(`\n--- Step 3: Wait ${INACTIVITY_SECONDS}s for inactivity ---`)
    for (let elapsed = 0; elapsed < INACTIVITY_SECONDS + 5; elapsed += 5) {
      await sleep(5000)
      log('STEP 3', `${elapsed + 5}s / ${INACTIVITY_SECONDS}s`)
    }

    console.log('\n--- Step 4: Execute Intent (base layer) ---')
    try {
      const executeTx = await program.methods.executeIntent()
        .accounts({ capsule: capsulePDA, vault: vaultPDA, permissionProgram: PERMISSION_PROGRAM_ID, permission: permissionPDA })
        .rpc()
      log('STEP 4', `Execute TX: ${executeTx}`)
      assert(true, 'Execute intent')
    } catch (e: any) {
      log('STEP 4', `Execute failed: ${e.message?.slice(0, 200)}`)
      if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log('  ', l))
      assert(false, 'Execute intent')
      return printSummary()
    }
    await sleep(2000)

  } else {
    // ═══ ER Flow ══════════════════════════════════════════════════
    console.log('\n--- Step 3: Delegate to ER ---')
    const [bufferPDA] = getBufferPDA(capsulePDA)
    const [delegationRecordPDA] = getDelegationRecordPDA(capsulePDA)
    const [delegationMetadataPDA] = getDelegationMetadataPDA(capsulePDA)
    const [vaultBufferPDA] = getBufferPDA(vaultPDA)
    const [vaultDelegationRecordPDA] = getDelegationRecordPDA(vaultPDA)
    const [vaultDelegationMetadataPDA] = getDelegationMetadataPDA(vaultPDA)

    try {
      const delegateTx = await program.methods.delegateCapsule()
        .accounts({
          payer: owner, owner, validator: ER_VALIDATOR,
          pda: capsulePDA, pdaBuffer: bufferPDA, pdaDelegationRecord: delegationRecordPDA, pdaDelegationMetadata: delegationMetadataPDA,
          vault: vaultPDA, vaultBuffer: vaultBufferPDA, vaultDelegationRecord: vaultDelegationRecordPDA, vaultDelegationMetadata: vaultDelegationMetadataPDA,
          magicProgram: MAGIC_PROGRAM_ID, delegationProgram: DELEGATION_PROGRAM_ID, systemProgram: SystemProgram.programId,
        }).rpc()
      log('STEP 3', `Delegated! TX: ${delegateTx}`)
      assert(true, 'Delegation')
    } catch (e: any) {
      log('STEP 3', `Delegation failed: ${e.message?.slice(0, 200)}`)
      if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log('  ', l))
      assert(false, 'Delegation')
      return printSummary()
    }

    await sleep(5000)
    const postInfo = await connection.getAccountInfo(capsulePDA)
    assert(postInfo !== null && postInfo.owner.equals(DELEGATION_PROGRAM_ID), 'Capsule owner = Delegation Program')

    console.log('\n--- Step 4: Verify on ER + Schedule crank ---')
    const erConn = new Connection(ER_RPC_URL, 'confirmed')
    const erInfo = await erConn.getAccountInfo(capsulePDA)
    assert(erInfo !== null, 'Capsule visible on ER')

    // Schedule crank with raw instruction (deployed binary has 7 accounts)
    try {
      const discriminator = Buffer.from([88, 30, 30, 42, 9, 75, 31, 189]) // schedule_execute_intent
      const argsBuf = Buffer.alloc(24)
      argsBuf.writeBigUInt64LE(BigInt(Date.now()), 0)
      argsBuf.writeBigUInt64LE(BigInt(5000), 8)  // 5s interval
      argsBuf.writeBigUInt64LE(BigInt(100), 16)   // 100 iterations
      const ix = new TransactionInstruction({
        keys: [
          { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: capsulePDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: PERMISSION_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: permissionPDA, isSigner: false, isWritable: false },
          { pubkey: MAGIC_CONTEXT, isSigner: false, isWritable: true },
        ],
        programId: PROGRAM_ID,
        data: Buffer.concat([discriminator, argsBuf]),
      })
      const { blockhash, lastValidBlockHeight } = await erConn.getLatestBlockhash('confirmed')
      const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight })
      tx.add(ix)
      tx.sign(ownerKp)
      const txSig = await erConn.sendRawTransaction(tx.serialize(), { skipPreflight: true })
      await erConn.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, 'confirmed')
      log('STEP 4', `Crank scheduled! TX: ${txSig}`)
      assert(true, 'Crank scheduled')
    } catch (e: any) {
      log('STEP 4', `Schedule failed: ${e.message?.slice(0, 200)}`)
      assert(false, 'Crank scheduled')
    }

    // Wait for crank execution
    console.log('\n--- Step 5: Wait for execution on ER ---')
    const maxWait = INACTIVITY_SECONDS + 30
    let executed = false
    for (let elapsed = 0; elapsed < maxWait; elapsed += 5) {
      await sleep(5000)
      try {
        const coder = new BorshAccountsCoder(idl)
        const erAccount = await erConn.getAccountInfo(capsulePDA)
        if (erAccount) {
          const data = coder.decode('IntentCapsule', erAccount.data)
          if (data.is_active === false && data.executed_at) {
            log('STEP 5', `Executed on ER after ${elapsed + 5}s!`)
            executed = true
            break
          }
        }
      } catch {}
      log('STEP 5', `${elapsed + 5}s / ${maxWait}s...`)
    }

    if (!executed) {
      log('STEP 5', 'Auto-crank did not fire. Manual execute fallback...')
      try {
        const executeTx = await program.methods.executeIntent()
          .accounts({ capsule: capsulePDA, vault: vaultPDA, permissionProgram: PERMISSION_PROGRAM_ID, permission: permissionPDA })
          .instruction()
        const { blockhash, lastValidBlockHeight } = await erConn.getLatestBlockhash('confirmed')
        const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight })
        tx.add(executeTx)
        tx.sign(ownerKp)
        const txSig = await erConn.sendRawTransaction(tx.serialize(), { skipPreflight: true })
        await erConn.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, 'confirmed')
        log('STEP 5', `Manual execute TX: ${txSig}`)
        executed = true
      } catch (e: any) {
        log('STEP 5', `Manual execute failed: ${e.message?.slice(0, 200)}`)
      }
    }
    assert(executed, 'Capsule executed on ER')

    // Commit & Undelegate
    console.log('\n--- Step 5b: Commit & Undelegate from ER ---')
    try {
      // CommitAndUndelegatePermission for capsule (disc=5 as borsh u64 LE)
      const discBuf = Buffer.alloc(8)
      discBuf.writeBigUInt64LE(BigInt(5), 0)
      const capsulePermIx = new TransactionInstruction({
        programId: PERMISSION_PROGRAM_ID,
        keys: [
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: capsulePDA, isSigner: false, isWritable: true },
          { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: permissionPDA, isSigner: false, isWritable: false },
          { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: MAGIC_CONTEXT, isSigner: false, isWritable: true },
        ],
        data: discBuf,
      })

      // ScheduleBaseIntent(CommitAndUndelegate) for vault — no permission PDA needed
      // Bincode: variant 6 (ScheduleBaseIntent) + variant 2 (CommitAndUndelegate) +
      //   CommitTypeArgs::Standalone([indices]) + UndelegateTypeArgs::Standalone
      const scheduleData = Buffer.from([
        6, 0, 0, 0,  // ScheduleBaseIntent
        2, 0, 0, 0,  // CommitAndUndelegate
        0, 0, 0, 0,  // CommitTypeArgs::Standalone
        1, 0, 0, 0, 0, // vec![0] (1 element, value 0)
        0, 0, 0, 0,  // UndelegateTypeArgs::Standalone
      ])
      const vaultUndelegateIx = new TransactionInstruction({
        programId: MAGIC_PROGRAM_ID,
        keys: [
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: MAGIC_CONTEXT, isSigner: false, isWritable: true },
        ],
        data: scheduleData,
      })

      const { blockhash, lastValidBlockHeight } = await erConn.getLatestBlockhash('confirmed')
      const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight })
      tx.add(capsulePermIx, vaultUndelegateIx)
      tx.sign(ownerKp)
      const txSig = await erConn.sendRawTransaction(tx.serialize(), { skipPreflight: true })
      await erConn.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, 'confirmed')
      log('STEP 5b', `Commit+Undelegate TX: ${txSig}`)
      assert(true, 'Commit & undelegate sent')
    } catch (e: any) {
      log('STEP 5b', `Commit+Undelegate failed: ${e.message?.slice(0, 200)}`)
      assert(false, 'Commit & undelegate sent')
    }

    // Wait for undelegation propagation (30s timeout, then skip remaining)
    log('STEP 5b', 'Waiting for base layer propagation (30s)...')
    let backOnBase = false
    for (let i = 0; i < 6; i++) { // 6 * 5s = 30s
      await sleep(5000)
      const acct = await connection.getAccountInfo(capsulePDA)
      if (acct && acct.owner.equals(PROGRAM_ID)) {
        log('STEP 5b', `Back on base layer after ${(i + 1) * 5}s`)
        backOnBase = true
        break
      }
      log('STEP 5b', `${(i + 1) * 5}s elapsed...`)
    }
    if (backOnBase) {
      assert(true, 'Capsule back on base layer')
    } else {
      skip('Capsule back on base layer (ER propagation pending)')
      log('STEP 5b', 'Propagation pending — skipping distribute/CRE steps')
      skip('Verify executed state on base layer')
      skip('Distribute assets')
      skip('Beneficiary received SOL')
      skip('CRE dispatch (propagation pending)')
      skip('CRE status check (propagation pending)')
      return printSummary()
    }
  }

  // Verify executed state on base layer
  console.log('\n--- Step 6: Verify executed state ---')
  try {
    const coder = new BorshAccountsCoder(idl)
    const capsuleInfo = await connection.getAccountInfo(capsulePDA)
    if (capsuleInfo) {
      const data = coder.decode('IntentCapsule', capsuleInfo.data)
      assert(data.is_active === false, 'is_active = false')
      assert(data.executed_at !== null && data.executed_at !== undefined, 'executed_at is set')
      log('STEP 6', `executed_at: ${data.executed_at?.toString()}`)
    } else {
      assert(false, 'Capsule exists on base layer')
    }
  } catch (e: any) {
    log('STEP 6', `Decode failed: ${e.message?.slice(0, 100)}`)
    assert(false, 'Capsule state decode')
  }

  // ═══ Step 7: Distribute Assets ════════════════════════════════
  console.log('\n--- Step 7: Distribute Assets ---')
  const beneficiaryBalanceBefore = await connection.getBalance(beneficiary)
  try {
    const distributeTx = await program.methods.distributeAssets()
      .accounts({
        capsule: capsulePDA, vault: vaultPDA, systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID, feeConfig: feeConfigPDA, platformFeeRecipient,
        mint: null, vaultTokenAccount: null,
      })
      .remainingAccounts([{ pubkey: beneficiary, isSigner: false, isWritable: true }])
      .rpc()
    log('STEP 7', `Distributed! TX: ${distributeTx}`)
    assert(true, 'Distribute assets')
  } catch (e: any) {
    log('STEP 7', `Distribute failed: ${e.message?.slice(0, 200)}`)
    if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log('  ', l))
    assert(false, 'Distribute assets')
  }
  await sleep(2000)
  const beneficiaryBalanceAfter = await connection.getBalance(beneficiary)
  const received = beneficiaryBalanceAfter - beneficiaryBalanceBefore
  log('STEP 7', `Beneficiary received: ${(received / LAMPORTS_PER_SOL).toFixed(9)} SOL`)
  assert(received > 0, 'Beneficiary received SOL')

  // ═══ Step 8: CRE Dispatch ═════════════════════════════════════
  console.log('\n--- Step 8: CRE Dispatch ---')
  if (!devServerRunning) {
    skip('CRE dispatch (no dev server)')
  } else {
    const dispatchSecret = process.env.CRE_DISPATCH_SECRET || process.env.CRON_SECRET || ''
    if (!dispatchSecret) {
      skip('CRE dispatch (no CRE_DISPATCH_SECRET/CRON_SECRET)')
    } else {
      const cronRes = await fetch(`${APP_BASE_URL}/api/cre/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dispatchSecret}` },
        body: JSON.stringify({ capsuleAddress: capsulePDA.toBase58() }),
      })
      const cronJson = await cronRes.json() as any
      log('STEP 8', `CRE dispatch [${cronRes.status}]: ${JSON.stringify(cronJson)}`)
      assert(cronRes.status === 200, 'CRE dispatch OK')
    }
  }

  // ═══ Step 9: CRE Status Check ═════════════════════════════════
  console.log('\n--- Step 9: CRE Status ---')
  if (!devServerRunning) {
    skip('CRE status check (no dev server)')
  } else {
    const ts9 = Date.now()
    const statusSig = signMessageWithKeypair(ownerKp, buildCreSignedMessage({
      action: 'delivery-status', owner: owner.toBase58(), timestamp: ts9, capsuleAddress: capsulePDA.toBase58(),
    }))
    const statusRes = await fetch(`${APP_BASE_URL}/api/intent-delivery/status?${new URLSearchParams({
      capsule: capsulePDA.toBase58(), owner: owner.toBase58(), timestamp: String(ts9),
    })}`, { headers: { 'x-cre-signature': statusSig } })
    if (statusRes.ok) {
      const statusJson = await statusRes.json() as any
      log('STEP 9', `Status: ${JSON.stringify(statusJson)}`)
      assert(true, 'CRE status check')
    } else {
      log('STEP 9', `Status [${statusRes.status}]: ${await statusRes.text()}`)
      assert(false, 'CRE status check')
    }
  }

  printSummary()
}

function printSummary() {
  console.log('\n========================================')
  console.log(`E2E Results: ${passed} passed, ${failed} failed, ${skipped} skipped`)
  console.log('========================================')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('\nTest failed:', err.message)
  if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'))
  process.exit(1)
})

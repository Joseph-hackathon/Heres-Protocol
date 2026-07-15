/**
 * Live devnet NFT inheritance check.
 *
 * Exercises the complete base-layer contract path: mint NFT, create capsule, deposit NFT, assign
 * recipient, fire the switch, distribute the NFT immediately, and verify the recipient balance plus
 * vault ATA closure.
 *
 * Run: node scripts/magicblock/nft-inheritance-check.mjs
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token'
import anchor from '@coral-xyz/anchor'
import { createHash, randomBytes } from 'crypto'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const { AnchorProvider, BN, Program, Wallet } = anchor
const REPO = join(homedir(), 'projects/heres-protocol')
const idl = JSON.parse(
  readFileSync(join(REPO, 'heres_program/target/idl/heres_program.json'), 'utf8')
)
const PROGRAM_ID = new PublicKey(idl.address)

function rpcUrl() {
  const cfg = readFileSync(join(homedir(), '.config/solana/cli/config.yml'), 'utf8')
  const match = cfg.match(/json_rpc_url:\s*"?([^"\s]+)"?/)
  return match?.[1] ?? 'https://api.devnet.solana.com'
}

function loadKeypair(name) {
  const raw = JSON.parse(readFileSync(join(homedir(), '.config/solana', name), 'utf8'))
  return Keypair.fromSecretKey(Uint8Array.from(raw))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const connection = new Connection(rpcUrl(), 'confirmed')
const funder = loadKeypair('id.json')
const owner = Keypair.generate()
const recipient = Keypair.generate()
const provider = new AnchorProvider(connection, new Wallet(owner), { commitment: 'confirmed' })
const program = new Program(idl, provider)

const [capsule] = PublicKey.findProgramAddressSync(
  [Buffer.from('intent_capsule'), owner.publicKey.toBuffer()],
  PROGRAM_ID
)
const [beneficiarySet] = PublicKey.findProgramAddressSync(
  [Buffer.from('beneficiary_set'), owner.publicKey.toBuffer()],
  PROGRAM_ID
)
const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from('capsule_vault'), owner.publicKey.toBuffer()],
  PROGRAM_ID
)
const [feeConfig] = PublicKey.findProgramAddressSync([Buffer.from('fee_config')], PROGRAM_ID)

const signatures = {}
const u16le = (value) => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes }
const u32le = (value) => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes }
const configCommitment = (ownerKey, beneficiaries, nftAssignments, salt) => {
  const parts = [Buffer.from('heres:inheritance-config:v1'), ownerKey.toBuffer(), u32le(beneficiaries.length)]
  for (const beneficiary of beneficiaries) {
    parts.push(beneficiary.pubkey.toBuffer(), u16le(beneficiary.shareBps))
  }
  parts.push(u32le(nftAssignments.length))
  for (const assignment of nftAssignments) {
    parts.push(assignment.mint.toBuffer(), assignment.recipient.toBuffer())
  }
  parts.push(salt)
  return Array.from(createHash('sha256').update(Buffer.concat(parts)).digest())
}

try {
  console.log('=== Heres live devnet NFT inheritance check ===')
  console.log('program   :', PROGRAM_ID.toBase58())
  console.log('owner     :', owner.publicKey.toBase58())
  console.log('recipient :', recipient.publicKey.toBase58())

  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: owner.publicKey,
      lamports: Math.floor(0.25 * LAMPORTS_PER_SOL),
    })
  )
  signatures.fund = await sendAndConfirmTransaction(connection, fundTx, [funder], {
    commitment: 'confirmed',
  })

  const mint = await createMint(connection, owner, owner.publicKey, null, 0)
  const ownerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    owner,
    mint,
    owner.publicKey
  )
  await mintTo(connection, owner, mint, ownerAta.address, owner, 1n)
  console.log('mint      :', mint.toBase58())

  const config = await program.account.feeConfig.fetch(feeConfig)
  const feeRecipient = config.creationFeeLamports.gt(new BN(0))
    ? config.feeRecipient
    : PROGRAM_ID

  signatures.create = await program.methods
    .createCapsule(new BN(2), owner.publicKey, null)
    .accountsPartial({
      capsule,
      beneficiarySet,
      vault,
      owner: owner.publicKey,
      feeConfig,
      platformFeeRecipient: feeRecipient,
      systemProgram: SystemProgram.programId,
    })
    .rpc()

  const vaultAta = getAssociatedTokenAddressSync(mint, vault, true)
  signatures.deposit = await program.methods
    .deposit(new BN(1))
    .accountsPartial({
      capsule,
      vault,
      owner: owner.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      mint,
      sourceTokenAccount: ownerAta.address,
      vaultTokenAccount: vaultAta,
    })
    .rpc()

  const beneficiaries = [
    { pubkey: recipient.publicKey, shareBps: 10000, reserved: Array(14).fill(0) },
  ]
  const nftAssignments = [{ mint, recipient: recipient.publicKey }]
  signatures.beneficiary = await program.methods
    .updateIntent(beneficiaries)
    .accountsPartial({ beneficiarySet, owner: owner.publicKey })
    .rpc()

  signatures.assignment = await program.methods
    .updateNftAssignments(nftAssignments)
    .accountsPartial({ beneficiarySet, owner: owner.publicKey })
    .rpc()

  const salt = randomBytes(32)
  const commitment = configCommitment(owner.publicKey, beneficiaries, nftAssignments, salt)
  signatures.seal = await program.methods
    .sealInheritance(Array.from(salt), commitment)
    .accountsPartial({ beneficiarySet, owner: owner.publicKey })
    .rpc()
  signatures.arm = await program.methods
    .armCapsule(commitment)
    .accountsPartial({ capsule, owner: owner.publicKey })
    .rpc()

  const stored = await program.account.beneficiarySet.fetch(beneficiarySet)
  if (
    stored.nftAssignments.length !== 1 ||
    !stored.nftAssignments[0].mint.equals(mint) ||
    !stored.nftAssignments[0].recipient.equals(recipient.publicKey)
  ) {
    throw new Error('NFT assignment did not persist correctly')
  }

  const locked = await getAccount(connection, vaultAta, 'confirmed')
  if (locked.amount !== 1n) throw new Error(`vault NFT balance is ${locked.amount}, expected 1`)

  await sleep(3500)
  signatures.execute = await program.methods
    .executeIntent()
    .accountsPartial({ capsule })
    .rpc()

  const recipientAta = await getOrCreateAssociatedTokenAccount(
    connection,
    owner,
    mint,
    recipient.publicKey
  )
  signatures.distribute = await program.methods
    .distributeNft(recipient.publicKey)
    .accountsPartial({
      capsule,
      beneficiarySet,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      mint,
      vaultTokenAccount: vaultAta,
      recipientTokenAccount: recipientAta.address,
    })
    .rpc()

  const inherited = await getAccount(connection, recipientAta.address, 'confirmed')
  if (inherited.amount !== 1n) {
    throw new Error(`recipient NFT balance is ${inherited.amount}, expected 1`)
  }
  if (await connection.getAccountInfo(vaultAta, 'confirmed')) {
    throw new Error('vault NFT account was not closed after distribution')
  }

  console.log('PASS assignment persisted')
  console.log('PASS vault received exactly one NFT')
  console.log('PASS switch fired on devnet')
  console.log('PASS assigned recipient received the NFT')
  console.log('PASS vault NFT account closed')
  for (const [step, signature] of Object.entries(signatures)) {
    console.log(`${step.padEnd(11)}: ${signature}`)
  }
} catch (error) {
  console.error('FAIL:', error.message)
  if (error.logs) error.logs.slice(-15).forEach((line) => console.error('  ', line))
  process.exit(1)
}

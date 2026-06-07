/**
 * Controlled live-fire: run distribute_assets for ONE capsule, signed by the crank wallet.
 * Mirrors lib/crank.ts distribute() (SOL path). Safety guards abort unless the capsule is
 * non-delegated + executed + not-yet-distributed. Prints before/after balances and asserts
 * capsule.distributed flips to true.
 *
 * Usage: node scripts/livefire-distribute-one.mjs [ownerPubkey]
 * Default owner = Gi6Z test capsule (undelegate-test-v2; beneficiary IS the crank wallet).
 */
import { Keypair, Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { readFileSync } from 'fs'
import { homedir } from 'os'

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const PROGRAM_ID = new PublicKey('2fLojZpdmXLeg2ZXRCXVsqiWnbpF2yFH1SVGS77UC8s3')
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const DISTRIBUTE_DISC = Buffer.from([239, 241, 19, 219, 144, 191, 154, 18])
const OWNER = new PublicKey(process.argv[2] || '6rK8G29unQJoPXEDoaxj3ytMctvDnofvxXT5y52WXEn8')

const readI64 = (b, o) => { let r = 0n; for (let i = 0; i < 8; i++) r |= BigInt(b[o + i]) << BigInt(i * 8); if (r & (1n << 63n)) r -= 1n << 64n; return r }
const readU32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)

function decodeCapsule(d) {
  let o = 8
  const owner = new PublicKey(d.slice(o, o + 32)); o += 32
  o += 8; o += 8
  const len = readU32(d, o); o += 4
  const intent = new TextDecoder().decode(d.slice(o, o + len)); o += len
  const isActive = d[o] === 1; o += 1
  const hasExec = d[o] === 1; o += 1
  let executedAt = null; if (hasExec) { executedAt = Number(readI64(d, o)); o += 8 }
  o += 1; o += 1
  const mint = new PublicKey(d.slice(o, o + 32)); o += 32
  o += 8; o += 2; o += 1
  let distributed = false
  if (o + 8 <= d.length) { o += 8; if (o < d.length) distributed = d[o] === 1 }
  return { owner, intent, isActive, executedAt, mint, distributed }
}

const c = new Connection(RPC, 'confirmed')
const crank = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(homedir() + '/.config/solana/heres-crank.json', 'utf8'))))
const [capsulePDA] = PublicKey.findProgramAddressSync([Buffer.from('intent_capsule'), OWNER.toBuffer()], PROGRAM_ID)
const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('capsule_vault'), OWNER.toBuffer()], PROGRAM_ID)
const [feeCfgPDA] = PublicKey.findProgramAddressSync([Buffer.from('fee_config')], PROGRAM_ID)

console.log('crank (fee payer): ', crank.publicKey.toBase58())
console.log('capsule:           ', capsulePDA.toBase58())
console.log('vault:             ', vaultPDA.toBase58())

const ai = await c.getAccountInfo(capsulePDA)
if (!ai) { console.error('ABORT: capsule not found'); process.exit(1) }
if (!ai.owner.equals(PROGRAM_ID)) { console.error('ABORT: capsule delegated (owner', ai.owner.toBase58() + '); undelegate first'); process.exit(1) }
const cap = decodeCapsule(ai.data)
console.log('state: active=' + cap.isActive, 'executed=' + (cap.executedAt != null), 'distributed=' + cap.distributed)
if (cap.isActive) { console.error('ABORT: capsule still active (not executed)'); process.exit(1) }
if (cap.executedAt == null) { console.error('ABORT: capsule not executed'); process.exit(1) }
if (cap.distributed) { console.error('ABORT: already distributed (nothing to do)'); process.exit(1) }
if (!cap.mint.equals(PublicKey.default)) { console.error('ABORT: SPL capsule; this test script is SOL-only'); process.exit(1) }

const fi = await c.getAccountInfo(feeCfgPDA)
const feeRecipient = new PublicKey(fi.data.slice(40, 72))
const bps = fi.data[80] | (fi.data[81] << 8)
console.log('fee_recipient:     ', feeRecipient.toBase58(), ' execution_fee_bps:', bps)

const intent = JSON.parse(cap.intent)
const beneficiaries = (intent.beneficiaries || []).filter((b) => (b.chain ?? 'solana') === 'solana').map((b) => new PublicKey(b.address))
console.log('beneficiaries:     ', beneficiaries.map((b) => b.toBase58()).join(', '))

const keys = [
  { pubkey: capsulePDA, isSigner: false, isWritable: true },
  { pubkey: vaultPDA, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: feeCfgPDA, isSigner: false, isWritable: false },
  { pubkey: feeRecipient, isSigner: false, isWritable: true },
  { pubkey: PROGRAM_ID, isSigner: false, isWritable: false }, // mint = None sentinel
  { pubkey: PROGRAM_ID, isSigner: false, isWritable: false }, // vault_token_account = None sentinel
  ...beneficiaries.map((b) => ({ pubkey: b, isSigner: false, isWritable: true })),
]

const before = {
  vault: await c.getBalance(vaultPDA),
  fee: await c.getBalance(feeRecipient),
  ben: await c.getBalance(beneficiaries[0]),
}
console.log('\nBEFORE  vault:', (before.vault / 1e9).toFixed(6), ' fee_recipient:', (before.fee / 1e9).toFixed(6), ' beneficiary:', (before.ben / 1e9).toFixed(6))

const ix = new TransactionInstruction({ keys, programId: PROGRAM_ID, data: DISTRIBUTE_DISC })
const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash('confirmed')
const tx = new Transaction({ feePayer: crank.publicKey, blockhash, lastValidBlockHeight })
tx.add(ix)
tx.sign(crank)

console.log('\nsending distribute_assets...')
let sig
try {
  sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false })
} catch (e) {
  console.error('FAILED:', e.message)
  if (e.logs) e.logs.forEach((l) => console.error('  ', l))
  process.exit(1)
}
await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
console.log('tx:', sig)

const after = {
  vault: await c.getBalance(vaultPDA),
  fee: await c.getBalance(feeRecipient),
  ben: await c.getBalance(beneficiaries[0]),
}
const cap2 = decodeCapsule((await c.getAccountInfo(capsulePDA)).data)
console.log('\nAFTER   vault:', (after.vault / 1e9).toFixed(6), ' fee_recipient:', (after.fee / 1e9).toFixed(6), ' beneficiary:', (after.ben / 1e9).toFixed(6))
console.log('deltas  vault:', ((after.vault - before.vault) / 1e9).toFixed(6), ' fee_recipient:', ((after.fee - before.fee) / 1e9).toFixed(6), ' beneficiary:', ((after.ben - before.ben) / 1e9).toFixed(6))
console.log('capsule.distributed:', cap2.distributed, cap2.distributed ? '(H1 guard set - replay-safe)' : '(NOT SET - problem!)')
console.log(cap2.distributed ? '\nLIVE-FIRE OK' : '\nLIVE-FIRE INCOMPLETE')

/**
 * Controlled live-fire: run execute_intent for ONE capsule on base, signed by the crank wallet.
 * Mirrors lib/crank.ts buildExecuteIntentIx + executeOnBase (4 accounts, state-only, no funds move).
 * Safety guards abort unless the capsule is non-delegated + active + not-yet-executed + elapsed.
 * Prints state before/after and asserts is_active flips false + executed_at gets stamped.
 *
 * Usage: node scripts/livefire-execute-one.mjs [ownerPubkey]
 * Default owner = F9M3 capsule (8For3M...; the one armed-and-elapsed dead-man's-switch).
 */
import { Keypair, Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import { readFileSync } from 'fs'
import { homedir } from 'os'

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const PROGRAM_ID = new PublicKey('2fLojZpdmXLeg2ZXRCXVsqiWnbpF2yFH1SVGS77UC8s3')
const PERMISSION_PROGRAM_ID = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1')
const EXECUTE_INTENT_DISC = Buffer.from([53, 130, 47, 154, 227, 220, 122, 212])
const OWNER = new PublicKey(process.argv[2] || '8For3MLAnJzQgZtGi7EYKXoi2FPkqycuepTuEgeibBsG')

const readI64 = (b, o) => { let r = 0n; for (let i = 0; i < 8; i++) r |= BigInt(b[o + i]) << BigInt(i * 8); if (r & (1n << 63n)) r -= 1n << 64n; return r }
const readU32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)

function decodeCapsule(d) {
  let o = 8
  const owner = new PublicKey(d.slice(o, o + 32)); o += 32
  const inactivityPeriod = Number(readI64(d, o)); o += 8
  const lastActivity = Number(readI64(d, o)); o += 8
  const len = readU32(d, o); o += 4
  o += len
  const isActive = d[o] === 1; o += 1
  const hasExec = d[o] === 1; o += 1
  let executedAt = null; if (hasExec) { executedAt = Number(readI64(d, o)); o += 8 }
  return { owner, inactivityPeriod, lastActivity, isActive, executedAt }
}

const c = new Connection(RPC, 'confirmed')
const crank = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(homedir() + '/.config/solana/heres-crank.json', 'utf8'))))
const [capsulePDA] = PublicKey.findProgramAddressSync([Buffer.from('intent_capsule'), OWNER.toBuffer()], PROGRAM_ID)
const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('capsule_vault'), OWNER.toBuffer()], PROGRAM_ID)
const [permissionPDA] = PublicKey.findProgramAddressSync([Buffer.from('permission'), capsulePDA.toBuffer()], PERMISSION_PROGRAM_ID)

console.log('crank (fee payer): ', crank.publicKey.toBase58())
console.log('owner:             ', OWNER.toBase58())
console.log('capsule:           ', capsulePDA.toBase58())
console.log('vault:             ', vaultPDA.toBase58())
console.log('permission:        ', permissionPDA.toBase58())

const ai = await c.getAccountInfo(capsulePDA)
if (!ai) { console.error('ABORT: capsule not found'); process.exit(1) }
if (!ai.owner.equals(PROGRAM_ID)) { console.error('ABORT: capsule delegated (owner', ai.owner.toBase58() + '); this is the base path'); process.exit(1) }
const cap = decodeCapsule(ai.data)
const now = Math.floor(Date.now() / 1000)
const elapsed = now >= cap.lastActivity + cap.inactivityPeriod
console.log('state: active=' + cap.isActive, 'executed=' + (cap.executedAt != null), 'elapsed=' + elapsed)
if (!cap.isActive) { console.error('ABORT: capsule not active (already executed?)'); process.exit(1) }
if (cap.executedAt != null) { console.error('ABORT: capsule already executed'); process.exit(1) }
if (!elapsed) { console.error('ABORT: inactivity window not elapsed; switch should NOT fire yet'); process.exit(1) }

const keys = [
  { pubkey: capsulePDA, isSigner: false, isWritable: true },
  { pubkey: vaultPDA, isSigner: false, isWritable: true },
  { pubkey: PERMISSION_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: permissionPDA, isSigner: false, isWritable: false },
]

const ix = new TransactionInstruction({ keys, programId: PROGRAM_ID, data: EXECUTE_INTENT_DISC })
const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash('confirmed')
const tx = new Transaction({ feePayer: crank.publicKey, blockhash, lastValidBlockHeight })
tx.add(ix)
tx.sign(crank)

console.log('\nsending execute_intent...')
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

const cap2 = decodeCapsule((await c.getAccountInfo(capsulePDA)).data)
console.log('\nAFTER  active=' + cap2.isActive, 'executed=' + (cap2.executedAt != null), cap2.executedAt != null ? '(executed_at=' + cap2.executedAt + ')' : '')
const ok = cap2.isActive === false && cap2.executedAt != null
console.log(ok ? '\nLIVE-FIRE OK (switch fired; state flipped, no funds moved - distribute is the next tick)' : '\nLIVE-FIRE INCOMPLETE')

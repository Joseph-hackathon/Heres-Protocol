/**
 * Read-only dry-run of the unified crank pipeline (lib/crank.ts) against live devnet capsules.
 * Sends NO transactions. Decodes every capsule and prints the action the pipeline WOULD take,
 * using the same classification rules. Surfaces executed-but-undistributed capsules = funds the
 * old flow stranded (no automated distribute existed).
 *
 * Enumerates via getProgramAccounts (catches non-delegated capsules). The production pipeline
 * enumerates via the owner registry, which additionally catches delegated capsules.
 *
 * Usage: node scripts/crank-pipeline-dryrun.mjs
 */
import { Connection, PublicKey } from '@solana/web3.js'

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || '2fLojZpdmXLeg2ZXRCXVsqiWnbpF2yFH1SVGS77UC8s3')
const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh')

function readI64(b, o) {
  let r = 0n
  for (let i = 0; i < 8; i++) r |= BigInt(b[o + i]) << BigInt(i * 8)
  if (r & (1n << 63n)) r -= 1n << 64n
  return r
}
function readU64(b, o) {
  let r = 0n
  for (let i = 0; i < 8; i++) r |= BigInt(b[o + i]) << BigInt(i * 8)
  return r
}
function readU32(b, o) {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)
}

function decode(data, accountOwner) {
  if (!data || data.length < 64) return null
  let o = 8
  const owner = new PublicKey(data.slice(o, o + 32)); o += 32
  const inactivityPeriod = Number(readI64(data, o)); o += 8
  const lastActivity = Number(readI64(data, o)); o += 8
  const len = readU32(data, o); o += 4
  const intentData = data.slice(o, o + len); o += len
  const isActive = data[o] === 1; o += 1
  const hasExec = data[o] === 1; o += 1
  let executedAt = null
  if (hasExec) { executedAt = Number(readI64(data, o)); o += 8 }
  o += 1 // bump
  o += 1 // vault_bump
  const mint = new PublicKey(data.slice(o, o + 32)); o += 32
  o += 8 // retry_count
  o += 2 // ccip_sent_bitmap
  o += 1 // private_distributed
  let distributed = false
  if (o + 8 <= data.length) { o += 8; if (o < data.length) { distributed = data[o] === 1; o += 1 } }
  return { owner, inactivityPeriod, lastActivity, intentData, isActive, executedAt, mint, distributed, accountOwner }
}

function classify(s, now) {
  const delegated = s.accountOwner.equals(DELEGATION_PROGRAM_ID)
  const executed = s.executedAt != null
  const elapsed = now >= s.lastActivity + s.inactivityPeriod
  if (delegated && s.isActive && elapsed) return 'EXECUTE-ER'
  if (delegated && executed) return 'UNDELEGATE'
  if (!delegated && s.isActive && elapsed) return 'EXECUTE-BASE'
  if (!delegated && !s.isActive && executed && !s.distributed) return 'DISTRIBUTE  <-- stranded by old flow'
  if (!delegated && executed && s.distributed) return 'DONE (unregister)'
  return 'WAITING'
}

const c = new Connection(RPC, 'confirmed')
const now = Math.floor(Date.now() / 1000)
const accounts = await c.getProgramAccounts(PROGRAM_ID)
console.log(`RPC ${RPC}`)
console.log(`program ${PROGRAM_ID.toBase58()}  -  ${accounts.length} capsule account(s)\n`)

const counts = {}
for (const a of accounts) {
  const s = decode(a.account.data, a.account.owner)
  if (!s) { console.log(`${a.pubkey.toBase58()}  UNDECODABLE`); continue }
  const action = classify(s, now)
  const key = action.split(' ')[0]
  counts[key] = (counts[key] || 0) + 1
  const asset = s.mint.equals(PublicKey.default) ? 'SOL' : `SPL ${s.mint.toBase58().slice(0, 6)}`
  const secsLeft = s.lastActivity + s.inactivityPeriod - now
  console.log(
    `${a.pubkey.toBase58()}  ${asset.padEnd(11)}  active=${s.isActive ? 'Y' : 'N'} ` +
    `exec=${s.executedAt ? 'Y' : 'N'} dist=${s.distributed ? 'Y' : 'N'}  ` +
    `${secsLeft > 0 ? `t-${secsLeft}s` : 'elapsed'}  ->  ${action}`
  )
}
console.log('\nsummary:', JSON.stringify(counts))

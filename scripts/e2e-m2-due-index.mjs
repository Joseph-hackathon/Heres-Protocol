/**
 * M2 end-to-end proof: the due-time index makes the crank fetch + act on ONLY the
 * capsules that are due, and re-admit a cold capsule once it crosses its fire-time.
 *
 * Flow (all base-only, beneficiary = crank, self-contained):
 *   1. Create 2 fast capsules (inactivity 10s) + 1 cold capsule (inactivity 75s).
 *   2. Register all 3 (seeded at due=0 -> all selected on the first tick).
 *   3. Tick 1: fast x2 execute+distribute+unregister; cold self-heals its due-time.
 *   4. Tick 2: due index returns ZERO (cold excluded). <- the core M2 win.
 *   5. Wait for cold to elapse, Tick 3: cold re-admitted, fires, registry empties.
 *
 * Requires the dev server running with the same CRON_SECRET this script is given,
 * and the FILE registry backend (no Redis/Postgres env) so it reads .data directly.
 *
 * Usage: CRON_SECRET=... node scripts/e2e-m2-due-index.mjs
 */
import { Connection, PublicKey } from '@solana/web3.js'
import { readFileSync, existsSync } from 'fs'
import { createTestCapsule } from './e2e-create-test-capsule.mjs'

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const SECRET = process.env.CRON_SECRET
const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const REGISTRY = new URL('../.data/capsule-registry.json', import.meta.url)
const CRANK = new PublicKey('3XjbnUmCRfq6tHZCfXuDSMKoapyxj9pnkaJSTVRfcEqd')

if (!SECRET) { console.error('CRON_SECRET env is required'); process.exit(1) }

const c = new Connection(RPC, 'confirmed')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sol = (lamports) => (lamports / 1e9).toFixed(6)
let failures = 0
function assert(cond, label) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failures++
}
function readRegistry() {
  if (!existsSync(REGISTRY)) return {}
  const parsed = JSON.parse(readFileSync(REGISTRY, 'utf8'))
  if (Array.isArray(parsed)) return Object.fromEntries(parsed.map((o) => [o, 0]))
  return parsed
}
async function register(owner) {
  const r = await fetch(`${BASE}/api/capsule-registry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ owner }),
  })
  if (!r.ok) throw new Error(`register ${owner} failed: ${r.status} ${await r.text()}`)
}
async function tick() {
  const r = await fetch(`${BASE}/api/cron/execute-intent`, {
    headers: { authorization: `Bearer ${SECRET}` },
  })
  const body = await r.json()
  return { status: r.status, body }
}

console.log('=== M2 due-index e2e ===\n')

console.log('[1] creating capsules (2 fast @10s, 1 cold @75s)...')
const fast1 = await createTestCapsule({ inactivity: 10, totalAmountSol: '0.003' })
const fast2 = await createTestCapsule({ inactivity: 10, totalAmountSol: '0.003' })
const cold = await createTestCapsule({ inactivity: 75, totalAmountSol: '0.003' })
const coldCreatedAt = Date.now()
console.log(`    fast1=${fast1.owner}\n    fast2=${fast2.owner}\n    cold =${cold.owner}\n`)

console.log('[2] registering all 3 for automation...')
for (const o of [fast1.owner, fast2.owner, cold.owner]) await register(o)
const reg0 = readRegistry()
console.log('    registry after register:', JSON.stringify(reg0))
assert(Object.keys(reg0).length === 3, 'registry has 3 owners')
assert([fast1, fast2, cold].every((x) => reg0[x.owner] === 0), 'all seeded at due=0 (DUE_UNKNOWN)')

const crankBal0 = await c.getBalance(CRANK)
console.log(`    crank balance: ${sol(crankBal0)} SOL\n`)

console.log('[3] waiting 12s for fast capsules to elapse, then TICK 1...')
await sleep(12000)
const t1 = await tick()
console.log('    tick1 status:', t1.status)
console.log('    tick1 result:', JSON.stringify(t1.body))
assert(t1.status === 200, 'tick1 HTTP 200')
assert(t1.body.dueSelected === 3, 'tick1 dueSelected = 3 (all seeded -> all due)')
assert(t1.body.fullScan === false, 'tick1 used the due index (not full scan)')
assert(t1.body.executedBase === 2, 'tick1 executed 2 on base')
assert(t1.body.distributed === 2, 'tick1 distributed 2')

const reg1 = readRegistry()
console.log('    registry after tick1:', JSON.stringify(reg1))
assert(Object.keys(reg1).length === 1 && cold.owner in reg1, 'only cold remains registered')
assert(typeof reg1[cold.owner] === 'number' && reg1[cold.owner] > Math.floor(Date.now() / 1000),
  'cold self-healed to a FUTURE due-time')

const crankBal1 = await c.getBalance(CRANK)
console.log(`    crank balance: ${sol(crankBal1)} SOL  (delta ${sol(crankBal1 - crankBal0)})`)
assert(crankBal1 > crankBal0, 'crank received the 2 payouts (funds actually moved)')
const v1 = await c.getBalance(new PublicKey(fast1.vault))
const v2 = await c.getBalance(new PublicKey(fast2.vault))
console.log(`    fast vaults drained to residual: ${sol(v1)} / ${sol(v2)} SOL`)
assert(v1 < fast1.vaultBalance && v2 < fast2.vaultBalance, 'fast vaults drained\n')

console.log('[4] TICK 2 immediately (cold not yet due)...')
const t2 = await tick()
console.log('    tick2 result:', JSON.stringify(t2.body))
assert(t2.status === 200, 'tick2 HTTP 200')
assert(t2.body.dueSelected === 0, 'tick2 dueSelected = 0  <-- index EXCLUDES the cold capsule')
assert(t2.body.scanned === 0, 'tick2 fetched 0 accounts (no wasted RPC on cold capsule)')
const reg2 = readRegistry()
assert(Object.keys(reg2).length === 1 && cold.owner in reg2, 'cold still registered, just not selected\n')

console.log('[5] waiting for cold to elapse (75s), then TICK 3...')
const waitMs = coldCreatedAt + 78000 - Date.now()
if (waitMs > 0) { console.log(`    sleeping ${Math.ceil(waitMs / 1000)}s...`); await sleep(waitMs) }
const t3 = await tick()
console.log('    tick3 result:', JSON.stringify(t3.body))
assert(t3.status === 200, 'tick3 HTTP 200')
assert(t3.body.dueSelected === 1, 'tick3 dueSelected = 1  <-- cold RE-ADMITTED now that it is due')
assert(t3.body.executedBase === 1 && t3.body.distributed === 1, 'tick3 fired + paid the cold capsule')
const reg3 = readRegistry()
console.log('    registry after tick3:', JSON.stringify(reg3))
assert(Object.keys(reg3).length === 0, 'registry empty: all capsules fully settled')

console.log(`\n=== ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} ===`)
process.exit(failures === 0 ? 0 : 1)

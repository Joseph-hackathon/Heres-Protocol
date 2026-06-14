/**
 * Offline build-check for the off-chain liveness service (lib/heartbeat.ts).
 *
 * lib/heartbeat.ts is server-only TS (path aliases, 'server-only'), so this mirrors its one on-chain
 * builder (update_activity, signed by the relayer / heartbeat_authority) against the same fresh-build
 * IDL and asserts the account layout matches the lean program - the exact ix the er-roundtrip TEE run
 * proved (relayer heartbeat on the ER). It also checks the relayer pubkey wiring: the public constant
 * must be valid base58, and (if .env is present) must equal the pubkey of CRANK_WALLET_PRIVATE_KEY, or
 * heartbeats silently fail and the switch fires on a living owner.
 *
 * Run: node scripts/magicblock/heartbeat-build-check.mjs
 */
import { PublicKey, Keypair, Connection } from '@solana/web3.js'
import anchor from '@coral-xyz/anchor'
import bs58 from 'bs58'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const { Program, AnchorProvider, Wallet } = anchor

const REPO = join(homedir(), 'projects/heres-protocol')
const idl = JSON.parse(readFileSync(join(REPO, 'idl/heres_program.json'), 'utf-8'))
const PROGRAM_ID = new PublicKey(idl.address)

const provider = new AnchorProvider(new Connection('https://api.devnet.solana.com'), new Wallet(Keypair.generate()), {})
const program = new Program(idl, provider)

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ' -- ' + detail : ''}`)
  }
}

const owner = Keypair.generate().publicKey
const relayer = Keypair.generate().publicKey
const [capsule] = PublicKey.findProgramAddressSync([Buffer.from('intent_capsule'), owner.toBuffer()], PROGRAM_ID)

console.log('=== heartbeat (update_activity) build-check ===\n')

// 1. IDL shape: update_activity exists, no args, exactly [capsule, authority].
const idlIx = idl.instructions.find((i) => i.name === 'update_activity')
check('IDL has update_activity', !!idlIx)
check('update_activity takes no args', idlIx && idlIx.args.length === 0)
check(
  'update_activity accounts == [capsule, authority]',
  idlIx && idlIx.accounts.map((a) => a.name).join(',') === 'capsule,authority',
  idlIx && idlIx.accounts.map((a) => a.name).join(',')
)

// 2. The exact builder lib/heartbeat.ts uses, signed by the relayer (NOT the owner).
const ix = await program.methods
  .updateActivity()
  .accountsPartial({ capsule, authority: relayer })
  .instruction()

check('builds against the lean IDL', !!ix && ix.keys.length === 2)
check('account[0] = capsule (writable, not signer)', ix.keys[0].pubkey.equals(capsule) && ix.keys[0].isWritable && !ix.keys[0].isSigner)
check('account[1] = relayer authority (signer)', ix.keys[1].pubkey.equals(relayer) && ix.keys[1].isSigner)
check('program id is the lean program', ix.programId.equals(PROGRAM_ID))

// 3. Relayer pubkey wiring: constant valid + matches the private key when .env is present.
const constLine = readFileSync(join(REPO, 'constants/index.ts'), 'utf-8')
  .split('\n')
  .find((l) => l.includes('CRANK_WALLET_PUBLIC_KEY') && l.includes("'"))
const constPubkey = constLine?.match(/'([1-9A-HJ-NP-Za-km-z]{32,44})'/)?.[1]
let constValid = false
try {
  if (constPubkey) {
    new PublicKey(constPubkey)
    constValid = true
  }
} catch {}
check('constants default relayer pubkey is valid base58', constValid, constPubkey || '(not found)')

const envPath = join(REPO, '.env')
if (existsSync(envPath)) {
  const env = readFileSync(envPath, 'utf-8').split('\n')
  const skLine = env.find((l) => l.startsWith('CRANK_WALLET_PRIVATE_KEY='))
  const pubLine = env.find((l) => l.startsWith('NEXT_PUBLIC_CRANK_WALLET_PUBLIC_KEY='))
  if (skLine) {
    const sk = skLine.slice('CRANK_WALLET_PRIVATE_KEY='.length).trim().replace(/^["']|["']$/g, '')
    let kp
    if (sk.startsWith('[')) kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(sk)))
    else if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(sk)) kp = Keypair.fromSecretKey(bs58.decode(sk))
    else kp = Keypair.fromSecretKey(Buffer.from(sk, 'base64'))
    const derived = kp.publicKey.toBase58()
    const envPub = pubLine?.slice('NEXT_PUBLIC_CRANK_WALLET_PUBLIC_KEY='.length).trim().replace(/^["']|["']$/g, '')
    check('.env NEXT_PUBLIC_CRANK_WALLET_PUBLIC_KEY matches CRANK_WALLET_PRIVATE_KEY', envPub === derived, `${envPub} vs ${derived}`)
  } else {
    console.log('  skip CRANK_WALLET_PRIVATE_KEY check (.env has no key)')
  }
} else {
  console.log('  skip .env keypair-match check (.env absent)')
}

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)

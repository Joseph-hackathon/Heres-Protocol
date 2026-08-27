import fs from 'fs'
import path from 'path'

try {
  const envPath = path.resolve(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    for (const l of lines) {
      const line = l.trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx > 0) {
        const k = line.slice(0, idx).trim()
        const v = line.slice(idx + 1).trim()
        if (k && (!process.env[k] || process.env[k] === '')) {
          process.env[k] = v
        }
      }
    }
  }
} catch {}

import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js'
import bs58 from 'bs58'
import { runCrankPipeline } from '../lib/crank.ts'
import { getDueOwners, getRegisteredOwners } from '../lib/capsule-registry.ts'
import { getSolanaConnection } from '../config/solana.ts'

function getCrankKeypair(): Keypair | null {
  const raw = process.env.CRANK_WALLET_PRIVATE_KEY
  if (!raw || raw.length < 32) return null
  try {
    if (raw.startsWith('[')) {
      const arr = JSON.parse(raw) as number[]
      if (arr.length !== 64) return null
      return Keypair.fromSecretKey(Uint8Array.from(arr))
    }
    if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(raw)) {
      return Keypair.fromSecretKey(bs58.decode(raw))
    }
    return Keypair.fromSecretKey(Buffer.from(raw, 'base64'))
  } catch {
    return null
  }
}

async function main() {
  console.log('\n=== Heres Protocol Local Crank Test Runner ===\n')

  const keypair = getCrankKeypair()
  if (!keypair) {
    console.error('Error: CRANK_WALLET_PRIVATE_KEY is not set or invalid in .env')
    console.error('Please ensure CRANK_WALLET_PRIVATE_KEY is populated in your .env file.')
    process.exit(1)
  }

  const conn = getSolanaConnection()
  const pubkey = keypair.publicKey.toBase58()
  console.log('[RPC Endpoint]', conn.rpcEndpoint)
  try {
    const bh = await conn.getLatestBlockhash('confirmed')
    console.log('[Recent Blockhash OK]', bh.blockhash.slice(0, 10) + '...')
  } catch (bhErr) {
    console.error('[Recent Blockhash Error]', bhErr)
  }
  console.log('[Crank Wallet]', pubkey)

  try {
    const balance = await conn.getBalance(keypair.publicKey)
    console.log('[Devnet Balance]', (balance / LAMPORTS_PER_SOL).toFixed(4), 'SOL')
    if (balance < 0.05 * LAMPORTS_PER_SOL) {
      console.warn('Warning: Crank wallet has low Devnet SOL balance (< 0.05 SOL).')
    }
  } catch (err) {
    console.warn('Could not fetch balance from Solana RPC:', err)
  }

  const now = Math.floor(Date.now() / 1000)
  const registered = await getRegisteredOwners().catch(() => [])
  const due = await getDueOwners(now).catch(() => [])

  console.log('[Registered Owners] Total:', registered.length)
  console.log('[Due Owners] Due Now (now=' + now + '):', due.length)
  if (registered.length > 0) {
    console.log('Registered addresses:', registered.join(', '))
  }

  console.log('\nExecuting runCrankPipeline()...\n')
  const startTime = Date.now()
  const result = await runCrankPipeline(keypair)
  const elapsedMs = Date.now() - startTime

  console.log('=== Pipeline Execution Results ===')
  console.log('Status:        ', result.ok ? 'OK' : 'Encountered Issues')
  console.log('Duration:      ', elapsedMs + 'ms')
  console.log('Due Selected:  ', result.dueSelected)
  console.log('Scanned:       ', result.scanned)
  console.log('Executed on ER:', result.executedEr)
  console.log('Executed Base: ', result.executedBase)
  console.log('Undelegated:   ', result.undelegated)
  console.log('Revealed (TEE):', result.revealed)
  console.log('Distributed:   ', result.distributed)
  console.log('Finalized:     ', result.finalized)

  if (result.errors.length > 0) {
    console.log('\nErrors/Notices:')
    result.errors.forEach((err, idx) => console.log('  ' + (idx + 1) + '. ' + err))
  } else {
    console.log('\nNo errors recorded during this tick.')
  }
}

main().catch((err) => {
  console.error('\nFatal error running local crank:', err)
  process.exit(1)
})

/**
 * Cron endpoint: off-chain liveness sync. Polls each registered owner's wallet activity via Helius and
 * bumps last_activity (as the relayer / heartbeat_authority) on genuinely new activity. This is the
 * proof-of-life input to the dead-man's-switch: using your wallet keeps you alive. Run on a short
 * interval (e.g. every 1-5 min) via Vercel Cron or external cron.
 *
 * Auth: Bearer CRON_SECRET. Signer: CRANK_WALLET_PRIVATE_KEY (must match NEXT_PUBLIC_CRANK_WALLET_PUBLIC_KEY,
 * which is the default heartbeat_authority + interact-only TEE permission member).
 */

import { NextRequest, NextResponse } from 'next/server'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { runLivenessSync } from '@/lib/heartbeat'

function getRelayerKeypair(): Keypair | null {
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

export async function GET(request: NextRequest) {
  return handleCron(request)
}

export async function POST(request: NextRequest) {
  return handleCron(request)
}

async function handleCron(request: NextRequest) {
  const auth = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) {
    return NextResponse.json({ error: 'CRON_SECRET is required' }, { status: 503 })
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const keypair = getRelayerKeypair()
  if (!keypair) {
    return NextResponse.json({ error: 'CRANK_WALLET_PRIVATE_KEY not set or invalid' }, { status: 500 })
  }

  try {
    const result = await runLivenessSync(keypair)
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

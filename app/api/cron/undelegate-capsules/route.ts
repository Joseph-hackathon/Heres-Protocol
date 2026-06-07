/**
 * Cron endpoint: undelegate executed capsules from the ER back to the base layer.
 *
 * Option B: undelegation is now one step of the unified crank pipeline (lib/crank.ts).
 * This route is retained for backward-compat with any external scheduler still calling it -
 * it simply runs the same pipeline, so whichever cron fires advances every capsule's state.
 * The execute-intent cron runs the identical pipeline; the two schedules can be collapsed to one.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { runCrankPipeline } from '@/lib/crank'

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

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

async function handle(request: NextRequest) {
  const auth = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) {
    return NextResponse.json({ error: 'CRON_SECRET is required' }, { status: 503 })
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const keypair = getCrankKeypair()
  if (!keypair) {
    return NextResponse.json({ error: 'CRANK_WALLET_PRIVATE_KEY not set or invalid' }, { status: 500 })
  }

  try {
    const result = await runCrankPipeline(keypair)
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

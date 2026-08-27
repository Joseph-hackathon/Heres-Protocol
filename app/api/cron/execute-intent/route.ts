export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * Cron endpoint: run the unified dead-man's-switch crank pipeline over all registered capsules.
 * Each tick advances every capsule one step: execute (base or ER) -> undelegate -> distribute.
 * Call at intervals (e.g. every 1-5 min) via Vercel Cron or external cron (cron-job.org).
 * Set CRANK_WALLET_PRIVATE_KEY (base58, base64, or JSON array of 64 bytes) and optionally
 * CRON_SECRET for auth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { runCrankPipeline } from '@/lib/crank'
import { reconcileIntentDeliveries } from '@/lib/intent-delivery/service'

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

function isAuthorized(request: NextRequest, secret: string): boolean {
  const auth = request.headers.get('authorization')
  if (auth === 'Bearer ' + secret) return true
  const querySecret = request.nextUrl.searchParams.get('secret') ?? request.nextUrl.searchParams.get('key')
  if (querySecret === secret) return true
  const customHeader = request.headers.get('x-cron-secret') ?? request.headers.get('x-cron-key')
  if (customHeader === secret) return true
  return false
}

export async function GET(request: NextRequest) {
  return handleCron(request)
}

export async function POST(request: NextRequest) {
  return handleCron(request)
}

async function handleCron(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) {
    return NextResponse.json({ error: 'CRON_SECRET is required' }, { status: 503 })
  }
  if (!isAuthorized(request, secret.trim())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const keypair = getCrankKeypair()
  if (!keypair) {
    return NextResponse.json(
      { error: 'CRANK_WALLET_PRIVATE_KEY not set or invalid' },
      { status: 500 }
    )
  }

  try {
    const [crankResult, intentResult] = await Promise.allSettled([
      runCrankPipeline(keypair),
      reconcileIntentDeliveries(),
    ])

    if (crankResult.status === 'rejected') {
      const message = crankResult.reason instanceof Error ? crankResult.reason.message : String(crankResult.reason)
      const cre =
        intentResult.status === 'fulfilled'
          ? intentResult.value
          : { error: intentResult.reason instanceof Error ? intentResult.reason.message : String(intentResult.reason) }
      return NextResponse.json({ error: message, cre }, { status: 500 })
    }

    return NextResponse.json({
      ...crankResult.value,
      cre:
        intentResult.status === 'fulfilled'
          ? intentResult.value
          : { error: intentResult.reason instanceof Error ? intentResult.reason.message : String(intentResult.reason) },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

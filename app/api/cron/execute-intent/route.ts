/**
 * Cron endpoint: run crank to execute all eligible capsules (conditions met).
 * Call this at intervals (e.g. every minute) via Vercel Cron or external cron.
 * Set CRANK_WALLET_PRIVATE_KEY (base58, base64, or JSON array of 64 bytes) and optionally
 * CRON_SECRET for auth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { distributeExecutedCapsules, runCrank, undelegateExecutedCapsules } from '@/lib/crank'
import { reconcileCreDeliveries } from '@/lib/cre/service'

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

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) return false

  const auth = request.headers.get('authorization')
  if (auth === `Bearer ${secret}`) return true

  const headerSecret = request.headers.get('x-cron-secret')
  if (headerSecret === secret) return true

  return request.nextUrl.searchParams.get('secret') === secret
}

function getMaxExecutions(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get('limit') || process.env.CRON_MAX_EXECUTIONS_PER_TICK || '1'
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
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
  if (!isAuthorized(request)) {
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
    const maxExecutions = getMaxExecutions(request)
    const crankResult = await Promise.allSettled([
      runCrank(keypair, { maxExecutions }),
      undelegateExecutedCapsules(keypair, maxExecutions),
      distributeExecutedCapsules(keypair, maxExecutions),
      reconcileCreDeliveries(),
    ])

    const [execution, undelegation, distribution, cre] = crankResult

    return NextResponse.json({
      maxExecutions,
      execution: execution.status === 'fulfilled' ? execution.value : { error: String(execution.reason) },
      undelegation: undelegation.status === 'fulfilled' ? undelegation.value : { error: String(undelegation.reason) },
      distribution: distribution.status === 'fulfilled' ? distribution.value : { error: String(distribution.reason) },
      cre: cre.status === 'fulfilled' ? cre.value : { error: String(cre.reason) },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

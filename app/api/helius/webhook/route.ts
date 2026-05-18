export const runtime = 'nodejs'

import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { enqueueHeliusWebhook, saveSyncCheckpoint } from '@/lib/dashboard-store'

const MAX_WEBHOOK_BYTES = 256 * 1024

function safeCompare(received: string | null, expected: string | null): boolean {
  if (!received || !expected) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function isVerified(authHeader: string | null): boolean {
  const expected = process.env.HELIUS_WEBHOOK_AUTH_TOKEN
  if (!expected) return false
  return safeCompare(authHeader, expected) || safeCompare(authHeader, `Bearer ${expected}`)
}

export async function POST(request: NextRequest) {
  if (!process.env.HELIUS_WEBHOOK_AUTH_TOKEN) {
    return NextResponse.json(
      { error: 'Helius webhook intake is retired. Use the dashboard indexer or generic RPC ingestion instead.' },
      { status: 410 }
    )
  }

  const contentType = request.headers.get('content-type') || ''
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json({ error: 'Unsupported content type' }, { status: 415 })
  }

  const declaredLength = Number(request.headers.get('content-length') || '0')
  if (declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  const rawBody = await request.text()
  if (rawBody.length > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  try {
    JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const headers = Object.fromEntries(request.headers.entries())
  const verified = isVerified(request.headers.get('authorization'))

  await enqueueHeliusWebhook(rawBody, headers, verified)
  await saveSyncCheckpoint('dashboard:webhook:last-received', {
    receivedAt: Date.now(),
    verified,
    contentLength: rawBody.length,
  })

  if (!verified) {
    return NextResponse.json({ error: 'Invalid webhook authorization' }, { status: 401 })
  }

  return NextResponse.json({ ok: true, queued: true })
}

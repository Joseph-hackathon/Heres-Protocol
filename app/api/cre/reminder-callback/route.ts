import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { applyCreReminderCallback, verifyCreReminderCallbackSignature } from '@/lib/cre/reminder-service'

type CallbackBody = {
  idempotencyKey?: string
  capsuleAddress?: string
  scheduledAt?: number | string
  status?: 'delivered' | 'failed'
  providerMessageId?: string
  error?: string
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  let body: CallbackBody
  try {
    body = JSON.parse(rawBody) as CallbackBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const signature = request.headers.get('x-cre-signature')
  if (!verifyCreReminderCallbackSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid callback signature' }, { status: 401 })
  }

  const capsuleAddress = body.capsuleAddress?.trim()
  const scheduledAt = Number(body.scheduledAt)
  const status = body.status
  if (!capsuleAddress || !Number.isFinite(scheduledAt) || (status !== 'delivered' && status !== 'failed')) {
    return NextResponse.json({ error: 'capsuleAddress, scheduledAt, status are required' }, { status: 400 })
  }

  try {
    new PublicKey(capsuleAddress)
  } catch {
    return NextResponse.json({ error: 'Invalid capsule address' }, { status: 400 })
  }

  const ledger = applyCreReminderCallback({
    idempotencyKey: body.idempotencyKey,
    capsuleAddress,
    scheduledAt,
    status,
    providerMessageId: body.providerMessageId,
    error: body.error,
  })

  return NextResponse.json({
    ok: true,
    idempotencyKey: ledger.idempotencyKey,
    status: ledger.status,
  })
}

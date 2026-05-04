import { createHmac } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { safeEqualHex } from '@/lib/cre/auth'

type CreDispatchPayload = {
  idempotencyKey: string
  capsuleAddress: string
  owner: string
  executedAt: number
  recipientEmail: string
  secretRef: string
  secretHash: string
  encryptedPayload: string
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function getBaseUrl(request: NextRequest): string {
  return process.env.MOCK_CRE_CALLBACK_BASE_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  let body: CreDispatchPayload
  try {
    body = JSON.parse(raw) as CreDispatchPayload
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const signingSecret = process.env.CHAINLINK_CRE_SIGNING_SECRET
  const receivedSig = request.headers.get('x-cre-signature')
  if (signingSecret) {
    const expected = sign(signingSecret, raw)
    if (!receivedSig || !safeEqualHex(receivedSig, expected)) {
      return NextResponse.json({ ok: false, error: 'Invalid x-cre-signature' }, { status: 401 })
    }
  }

  const shouldFail = process.env.MOCK_CRE_FORCE_FAIL === 'true'
  const autoCallback = process.env.MOCK_CRE_AUTO_CALLBACK !== 'false'
  const callbackSecret = process.env.CHAINLINK_CRE_CALLBACK_SECRET

  if (autoCallback) {
    const callbackBody = JSON.stringify({
      idempotencyKey: body.idempotencyKey,
      capsuleAddress: body.capsuleAddress,
      executedAt: body.executedAt,
      status: shouldFail ? 'failed' : 'delivered',
      providerMessageId: shouldFail ? undefined : `mock-cre-${Date.now()}`,
      error: shouldFail ? 'MOCK_CRE_FORCE_FAIL enabled' : undefined,
    })

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (callbackSecret) {
      headers['x-cre-signature'] = sign(callbackSecret, callbackBody)
    }

    try {
      const callbackRes = await fetch(`${getBaseUrl(request)}/api/cre/callback`, {
        method: 'POST',
        headers,
        body: callbackBody,
      })
      if (!callbackRes.ok) {
        const callbackErrorBody = await callbackRes.text()
        return NextResponse.json(
          {
            ok: false,
            error: `Callback failed ${callbackRes.status}: ${callbackErrorBody || callbackRes.statusText}`,
          },
          { status: 502 }
        )
      }
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    ok: true,
    mode: 'mock-cre',
    autoCallback,
    status: shouldFail ? 'failed' : 'delivered',
    idempotencyKey: body.idempotencyKey,
  })
}

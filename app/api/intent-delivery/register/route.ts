import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { isValidEmail } from '@/utils/validation'
import { registerIntentSecret } from '@/lib/intent-delivery/service'
import { sha256Hex, verifyIntentSignedRequest } from '@/lib/intent-delivery/auth'

type RegisterRequestBody = {
  owner?: string
  recipientEmail?: string
  // Plaintext intent statement. Encrypted at rest server-side; never stored or
  // logged in the clear. Sent over TLS and bound by the wallet signature below.
  message?: string
  timestamp?: number
  signature?: string
}

// Plaintext statement bound by the owner signature; capped to a sane size.
const MAX_MESSAGE_LENGTH = 20_000

export async function POST(request: NextRequest) {
  let body: RegisterRequestBody
  try {
    body = (await request.json()) as RegisterRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const owner = body.owner?.trim()
  const recipientEmail = body.recipientEmail?.trim().toLowerCase()
  const message = typeof body.message === 'string' ? body.message : undefined
  const timestamp = Number(body.timestamp)
  const signature = body.signature?.trim()

  if (!owner || !recipientEmail || !message || !message.trim() || !signature || !Number.isFinite(timestamp)) {
    return NextResponse.json(
      { error: 'owner, recipientEmail, message, timestamp, signature are required' },
      { status: 400 }
    )
  }

  try {
    new PublicKey(owner)
  } catch {
    return NextResponse.json({ error: 'Invalid owner address' }, { status: 400 })
  }

  if (!isValidEmail(recipientEmail)) {
    return NextResponse.json({ error: 'Invalid recipient email' }, { status: 400 })
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'Intent statement is too large' }, { status: 400 })
  }

  const recipientEmailHash = sha256Hex(recipientEmail)
  const messageHash = sha256Hex(message)
  const isValidSignature = verifyIntentSignedRequest({
    action: 'register-secret',
    owner,
    timestamp,
    signatureBase64: signature,
    recipientEmailHash,
    messageHash,
  })
  if (!isValidSignature) {
    return NextResponse.json({ error: 'Invalid or expired signature' }, { status: 401 })
  }

  let registered
  try {
    registered = await registerIntentSecret({ owner, recipientEmail, message })
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : 'Failed to register intent statement'
    return NextResponse.json({ error: errMessage }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    secretRef: registered.secretRef,
    secretHash: registered.secretHash,
    recipientEmailHash: registered.recipientEmailHash,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { isValidEmail } from '@/utils/validation'
import { registerCreSecret } from '@/lib/cre/service'
import { sha256Hex, verifyCreSignedRequest } from '@/lib/cre/auth'

type RegisterRequestBody = {
  owner?: string
  recipientEmail?: string
  encryptedPayload?: string
  timestamp?: number
  signature?: string
}

export async function POST(request: NextRequest) {
  let body: RegisterRequestBody
  try {
    body = (await request.json()) as RegisterRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const owner = body.owner?.trim()
  const recipientEmail = body.recipientEmail?.trim().toLowerCase()
  const encryptedPayload = body.encryptedPayload?.trim()
  const timestamp = Number(body.timestamp)
  const signature = body.signature?.trim()

  if (!owner || !recipientEmail || !encryptedPayload || !signature || !Number.isFinite(timestamp)) {
    return NextResponse.json(
      { error: 'owner, recipientEmail, encryptedPayload, timestamp, signature are required' },
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

  if (encryptedPayload.length > 32_000) {
    return NextResponse.json({ error: 'Encrypted payload is too large' }, { status: 400 })
  }

  const recipientEmailHash = sha256Hex(recipientEmail)
  const encryptedPayloadHash = sha256Hex(encryptedPayload)
  const isValidSignature = verifyCreSignedRequest({
    action: 'register-secret',
    owner,
    timestamp,
    signatureBase64: signature,
    recipientEmailHash,
    encryptedPayloadHash,
  })
  if (!isValidSignature) {
    return NextResponse.json({ error: 'Invalid or expired signature' }, { status: 401 })
  }

  const registered = registerCreSecret({
    owner,
    recipientEmail,
    encryptedPayload,
  })

  return NextResponse.json({
    ok: true,
    secretRef: registered.secretRef,
    secretHash: registered.secretHash,
    recipientEmailHash: registered.recipientEmailHash,
  })
}

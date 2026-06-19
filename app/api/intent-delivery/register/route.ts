import { NextRequest, NextResponse } from 'next/server'
import { registerIntentSecret } from '@/lib/intent-delivery/service'
import { sha256Hex, verifyIntentSignedRequest } from '@/lib/intent-delivery/auth'
import { intentRegisterBody, firstError } from '@/lib/schemas'

export async function POST(request: NextRequest) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // The client is untrusted: re-validate the whole body (owner pubkey, email, plaintext intent length,
  // timestamp, signature) before doing any work. The plaintext message is encrypted at rest in the
  // service and never logged in the clear; it stays bound by the owner signature verified below.
  const parsed = intentRegisterBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 })
  }
  const owner = parsed.data.owner
  const recipientEmail = parsed.data.recipientEmail.toLowerCase()
  const message = parsed.data.message
  const { timestamp, signature } = parsed.data

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

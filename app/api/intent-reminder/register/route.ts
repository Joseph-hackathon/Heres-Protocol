import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { getCapsulePDA } from '@/lib/program'
import { registerIntentReminder } from '@/lib/intent-delivery/reminder-service'
import { sha256Hex, verifyIntentSignedRequest } from '@/lib/intent-delivery/auth'
import { intentReminderBody, firstError } from '@/lib/schemas'

export async function POST(request: NextRequest) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = intentReminderBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 })
  }
  const d = parsed.data
  const capsuleAddress = d.capsuleAddress
  const owner = d.owner
  const recipientEmail = d.recipientEmail.toLowerCase()
  const assetSymbol = d.assetSymbol || 'Unknown'
  const assetLabel = d.assetLabel || assetSymbol
  const inactivityLabel = d.inactivityLabel || 'Not configured'
  const totalAmount = d.totalAmount
  const beneficiaryCount = d.beneficiaryCount
  const delayDays = d.delayDays
  const createdAt = d.createdAt
  const { timestamp, signature } = d

  const ownerPubkey = new PublicKey(owner)
  const capsulePubkey = new PublicKey(capsuleAddress)

  const [expectedCapsulePda] = getCapsulePDA(ownerPubkey)
  if (!capsulePubkey.equals(expectedCapsulePda)) {
    return NextResponse.json({ error: 'Capsule PDA does not match owner' }, { status: 403 })
  }

  const recipientEmailHash = sha256Hex(recipientEmail)
  const isValidSignature = verifyIntentSignedRequest({
    action: 'register-reminder',
    owner,
    capsuleAddress,
    timestamp,
    signatureBase64: signature,
    recipientEmailHash,
  })
  if (!isValidSignature) {
    return NextResponse.json({ error: 'Invalid or expired signature' }, { status: 401 })
  }

  let registered
  try {
    registered = await registerIntentReminder({
      capsuleAddress,
      owner,
      recipientEmail,
      assetSymbol,
      assetLabel,
      totalAmount,
      beneficiaryCount,
      inactivityLabel,
      delayDays,
      createdAt: createdAt ?? Date.now(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to register CRE reminder'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    reminderId: registered.reminderId,
    nextReminderAt: registered.nextReminderAt,
    recipientEmailHash: registered.recipientEmailHash,
    reminderIntervalDays: registered.reminderIntervalDays,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { getCapsulePDA } from '@/lib/program'
import { registerIntentReminder } from '@/lib/intent-delivery/reminder-service'
import { sha256Hex, verifyIntentSignedRequest } from '@/lib/intent-delivery/auth'
import { isValidEmail } from '@/utils/validation'

type RegisterReminderRequestBody = {
  capsuleAddress?: string
  owner?: string
  recipientEmail?: string
  assetSymbol?: string
  assetLabel?: string
  totalAmount?: string
  beneficiaryCount?: number
  inactivityLabel?: string
  delayDays?: number
  createdAt?: number
  timestamp?: number
  signature?: string
}

export async function POST(request: NextRequest) {
  let body: RegisterReminderRequestBody
  try {
    body = (await request.json()) as RegisterReminderRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const capsuleAddress = body.capsuleAddress?.trim()
  const owner = body.owner?.trim()
  const recipientEmail = body.recipientEmail?.trim().toLowerCase()
  const assetSymbol = body.assetSymbol?.trim() || 'Unknown'
  const assetLabel = body.assetLabel?.trim() || assetSymbol
  const inactivityLabel = body.inactivityLabel?.trim() || 'Not configured'
  const totalAmount = body.totalAmount?.trim()
  const beneficiaryCount = Number(body.beneficiaryCount)
  const delayDays = Number(body.delayDays)
  const createdAt = Number(body.createdAt)
  const timestamp = Number(body.timestamp)
  const signature = body.signature?.trim()

  if (
    !capsuleAddress ||
    !owner ||
    !recipientEmail ||
    !signature ||
    !Number.isFinite(timestamp) ||
    !Number.isFinite(beneficiaryCount) ||
    !Number.isFinite(delayDays)
  ) {
    return NextResponse.json(
      {
        error:
          'capsuleAddress, owner, recipientEmail, beneficiaryCount, delayDays, timestamp, signature are required',
      },
      { status: 400 }
    )
  }

  let ownerPubkey: PublicKey
  let capsulePubkey: PublicKey
  try {
    ownerPubkey = new PublicKey(owner)
    capsulePubkey = new PublicKey(capsuleAddress)
  } catch {
    return NextResponse.json({ error: 'Invalid owner or capsule address' }, { status: 400 })
  }

  const [expectedCapsulePda] = getCapsulePDA(ownerPubkey)
  if (!capsulePubkey.equals(expectedCapsulePda)) {
    return NextResponse.json({ error: 'Capsule PDA does not match owner' }, { status: 403 })
  }

  if (!isValidEmail(recipientEmail)) {
    return NextResponse.json({ error: 'Invalid recipient email' }, { status: 400 })
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
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
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

import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { getReminderStatus } from '@/lib/intent-delivery/reminder-service'
import { verifyIntentSignedRequest } from '@/lib/intent-delivery/auth'
import { fetchCapsuleStateByAddress } from '@/lib/intent-delivery/solana'

export async function GET(request: NextRequest) {
  const capsuleAddress = request.nextUrl.searchParams.get('capsule')?.trim()
  const owner = request.nextUrl.searchParams.get('owner')?.trim()
  const timestamp = Number(request.nextUrl.searchParams.get('timestamp'))
  const signature = request.headers.get('x-intent-signature')?.trim()

  if (!capsuleAddress) {
    return NextResponse.json({ error: 'capsule query parameter is required' }, { status: 400 })
  }
  if (!owner || !signature || !Number.isFinite(timestamp)) {
    return NextResponse.json({ error: 'owner, timestamp, x-intent-signature are required' }, { status: 400 })
  }

  let capsulePubkey: PublicKey
  let ownerPubkey: PublicKey
  try {
    capsulePubkey = new PublicKey(capsuleAddress)
    ownerPubkey = new PublicKey(owner)
  } catch {
    return NextResponse.json({ error: 'Invalid capsule or owner address' }, { status: 400 })
  }

  const capsule = await fetchCapsuleStateByAddress(capsulePubkey)
  if (!capsule) {
    return NextResponse.json({ error: 'Capsule not found' }, { status: 404 })
  }
  if (!capsule.owner.equals(ownerPubkey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const isValidSignature = verifyIntentSignedRequest({
    action: 'reminder-status',
    owner,
    capsuleAddress,
    timestamp,
    signatureBase64: signature,
  })
  if (!isValidSignature) {
    return NextResponse.json({ error: 'Invalid or expired signature' }, { status: 401 })
  }

  const { reminder, deliveries } = await getReminderStatus(capsuleAddress)
  return NextResponse.json({
    ok: true,
    reminder: reminder
      ? {
          reminderId: reminder.reminderId,
          status: reminder.status,
          nextReminderAt: reminder.nextReminderAt,
          lastReminderAt: reminder.lastReminderAt,
          lastDeliveryStatus: reminder.lastDeliveryStatus,
          reminderIntervalDays: reminder.reminderIntervalDays,
        }
      : null,
    deliveries: deliveries.map((entry) => ({
      idempotencyKey: entry.idempotencyKey,
      scheduledAt: entry.scheduledAt,
      status: entry.status,
      updatedAt: entry.updatedAt,
      lastError: entry.lastError,
    })),
  })
}

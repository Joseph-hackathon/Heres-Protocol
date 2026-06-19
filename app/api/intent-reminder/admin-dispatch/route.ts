import { NextRequest, NextResponse } from 'next/server'
import { dispatchIntentReminderForCapsule } from '@/lib/intent-delivery/reminder-service'
import { capsuleAddressBody, firstError } from '@/lib/schemas'

function getDispatchSecret(): string | null {
  const value = process.env.INTENT_REMINDER_DISPATCH_SECRET || process.env.CRON_SECRET
  if (!value || !value.trim()) return null
  return value.trim()
}

export async function POST(request: NextRequest) {
  const secret = getDispatchSecret()
  if (!secret) {
    return NextResponse.json(
      { error: 'INTENT_REMINDER_DISPATCH_SECRET or CRON_SECRET is required' },
      { status: 503 }
    )
  }

  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = capsuleAddressBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 })
  }

  const result = await dispatchIntentReminderForCapsule(parsed.data.capsuleAddress)
  let statusCode = 500
  if (result.ok || result.skipped) {
    statusCode = 200
  } else if (result.error === 'Invalid capsule address') {
    statusCode = 400
  } else if (result.error === 'Reminder registration not found' || result.error === 'Capsule not found') {
    statusCode = 404
  }

  return NextResponse.json(result, { status: statusCode })
}

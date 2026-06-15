import { NextRequest, NextResponse } from 'next/server'
import { reconcileIntentReminders } from '@/lib/intent-delivery/reminder-service'

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) return false
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

async function handle(request: NextRequest) {
  if (!process.env.CRON_SECRET || !process.env.CRON_SECRET.trim()) {
    return NextResponse.json({ error: 'CRON_SECRET is required' }, { status: 503 })
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await reconcileIntentReminders()
  return NextResponse.json({ ok: true, ...result })
}

import { NextRequest, NextResponse } from 'next/server'
import { reconcileIntentReminders } from '@/lib/intent-delivery/reminder-service'

function isAuthorized(request: NextRequest, secret: string): boolean {
  const auth = request.headers.get('authorization')
  if (auth === 'Bearer ' + secret) return true
  const querySecret = request.nextUrl.searchParams.get('secret') ?? request.nextUrl.searchParams.get('key')
  if (querySecret === secret) return true
  const customHeader = request.headers.get('x-cron-secret') ?? request.headers.get('x-cron-key')
  if (customHeader === secret) return true
  return false
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) {
    return NextResponse.json({ error: 'CRON_SECRET is required' }, { status: 503 })
  }

  if (!isAuthorized(request, secret.trim())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await reconcileIntentReminders()
  return NextResponse.json({ ok: true, ...result })
}

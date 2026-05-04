import { NextRequest, NextResponse } from 'next/server'
import { dispatchCreDeliveryForCapsule } from '@/lib/cre/service'

type DispatchRequestBody = {
  capsuleAddress?: string
}

function getDispatchSecret(): string | null {
  const value = process.env.CRE_DISPATCH_SECRET || process.env.CRON_SECRET
  if (!value || !value.trim()) return null
  return value.trim()
}

export async function POST(request: NextRequest) {
  const secret = getDispatchSecret()
  if (!secret) {
    return NextResponse.json({ error: 'CRE_DISPATCH_SECRET or CRON_SECRET is required' }, { status: 503 })
  }

  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: DispatchRequestBody
  try {
    body = (await request.json()) as DispatchRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const capsuleAddress = body.capsuleAddress?.trim()
  if (!capsuleAddress) {
    return NextResponse.json({ error: 'capsuleAddress is required' }, { status: 400 })
  }

  const result = await dispatchCreDeliveryForCapsule(capsuleAddress)
  let statusCode = 500
  if (result.ok || result.skipped) {
    statusCode = 200
  } else if (result.error === 'Invalid capsule address') {
    statusCode = 400
  } else if (result.error === 'Capsule not found') {
    statusCode = 404
  }
  return NextResponse.json(result, { status: statusCode })
}

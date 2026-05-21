import { NextRequest, NextResponse } from 'next/server'
import { getCapsuleSubscription } from '@/lib/subscription-store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const capsuleAddress = searchParams.get('capsule')

    if (!capsuleAddress) {
      return NextResponse.json(
        { error: 'Missing capsule query parameter' },
        { status: 400 }
      )
    }

    const sub = await getCapsuleSubscription(capsuleAddress)

    if (!sub) {
      return NextResponse.json({
        active: false,
        status: 'inactive',
        monitoringEnabled: false,
        paymentMethod: null,
        currentPeriodEnd: null,
      })
    }

    // A subscription is active if:
    // 1. status is 'active' or 'trialing'
    // 2. and the current_period_end is in the future
    const isPeriodValid = sub.current_period_end
      ? new Date(sub.current_period_end).getTime() > Date.now()
      : false

    const isActive =
      sub.monitoring_enabled &&
      (sub.status === 'active' || sub.status === 'trialing') &&
      isPeriodValid

    return NextResponse.json({
      active: isActive,
      status: sub.status,
      monitoringEnabled: sub.monitoring_enabled,
      paymentMethod: sub.payment_method,
      currentPeriodEnd: sub.current_period_end,
      streamId: sub.stream_id,
    })
  } catch (error: any) {
    console.error('[subscription-status] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}

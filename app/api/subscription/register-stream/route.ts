import { NextRequest, NextResponse } from 'next/server'
import { upsertWeb3StreamSubscription } from '@/lib/subscription-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { capsuleAddress, ownerAddress, streamId, durationSeconds } = body

    if (!capsuleAddress || !ownerAddress || !streamId) {
      return NextResponse.json(
        { error: 'Missing capsuleAddress, ownerAddress, or streamId' },
        { status: 400 }
      )
    }

    // Default duration is 30 days if not provided
    const duration = durationSeconds ? Number(durationSeconds) : 30 * 24 * 60 * 60
    const currentPeriodEnd = new Date(Date.now() + duration * 1000)

    await upsertWeb3StreamSubscription(
      capsuleAddress,
      ownerAddress,
      streamId,
      'active',
      currentPeriodEnd
    )

    return NextResponse.json({
      success: true,
      capsuleAddress,
      streamId,
      currentPeriodEnd: currentPeriodEnd.toISOString(),
    })
  } catch (error: any) {
    console.error('[register-stream] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}

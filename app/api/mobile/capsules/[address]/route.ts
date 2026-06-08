import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { getCapsuleByAddress } from '@/lib/solana'
import { computeCapsuleStatus } from '@/lib/mobile'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address: capsuleAddress } = await params
    let capsulePda: PublicKey
    try {
      capsulePda = new PublicKey(capsuleAddress)
    } catch {
      return NextResponse.json({ error: 'Invalid capsule address' }, { status: 400 })
    }

    const capsule = await getCapsuleByAddress(capsulePda)
    if (!capsule) {
      return NextResponse.json({ error: 'Capsule not found' }, { status: 404 })
    }

    const status = computeCapsuleStatus({
      isActive: capsule.isActive,
      lastActivity: capsule.lastActivity,
      inactivityPeriod: capsule.inactivityPeriod,
      executedAt: capsule.executedAt,
    })

    return NextResponse.json({
      capsuleAddress,
      owner: capsule.owner.toBase58(),
      status,
      inactivitySeconds: capsule.inactivityPeriod,
      lastActivityAt: capsule.lastActivity * 1000,
      executedAt: capsule.executedAt ? capsule.executedAt * 1000 : null,
      nextInactivityDeadline: (capsule.lastActivity + capsule.inactivityPeriod) * 1000,
      isActive: capsule.isActive,
      hasMint: Boolean(capsule.mint),
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch capsule detail' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { getCapsule } from '@/lib/solana'
import { getEnhancedTransactions } from '@/lib/helius'
import { buildActivityScore } from '@/lib/mobile'
import { walletBody, firstError } from '@/lib/schemas'

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => ({}))
    const parsed = walletBody.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 })
    }
    const wallet = parsed.data.wallet
    const owner = new PublicKey(wallet)
    const capsule = await getCapsule(owner)
    if (!capsule) {
      return NextResponse.json({
        canExtend: false,
        reason: 'No capsule found for wallet',
        nextInactivityDeadline: null,
        suggestedFeeLamports: 5000,
      })
    }

    if (!capsule.isActive || capsule.executedAt) {
      return NextResponse.json({
        canExtend: false,
        reason: 'Capsule is not active',
        nextInactivityDeadline: (capsule.lastActivity + capsule.inactivityPeriod) * 1000,
        suggestedFeeLamports: 5000,
      })
    }

    const txs = await getEnhancedTransactions(wallet, 100)
    const score = buildActivityScore(wallet, txs)

    const now = Date.now()
    const nextDeadline = (capsule.lastActivity + capsule.inactivityPeriod) * 1000
    const remainingMs = Math.max(0, nextDeadline - now)

    const canExtend = score.score >= 60

    return NextResponse.json({
      canExtend,
      reason: canExtend
        ? 'Sufficient recent activity detected'
        : 'Insufficient on-chain activity score',
      nextInactivityDeadline: nextDeadline,
      suggestedFeeLamports: 5000,
      remainingMs,
      score,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to generate extend preview' },
      { status: 500 }
    )
  }
}

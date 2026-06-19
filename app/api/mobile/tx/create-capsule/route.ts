import { NextRequest, NextResponse } from 'next/server'
import { buildCreateCapsuleUnsignedTx } from '@/lib/mobile-tx'
import { mobileCreateCapsuleBody, firstError } from '@/lib/schemas'

export async function POST(request: NextRequest) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate the full body (owner pubkey, amounts, inactivity bounds, beneficiary != owner, capped
  // intent) before building a tx - the web flow validates client-side, mobile callers do not.
  const parsed = mobileCreateCapsuleBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 })
  }

  try {
    const unsigned = await buildCreateCapsuleUnsignedTx({
      owner: parsed.data.owner,
      totalSol: parsed.data.totalSol,
      inactivityDays: parsed.data.inactivityDays,
      beneficiaryAddress: parsed.data.beneficiaryAddress,
      beneficiaryAmountSol: parsed.data.beneficiaryAmountSol,
      intent: parsed.data.intent,
    })

    return NextResponse.json({
      ...unsigned,
      message: 'Unsigned create_capsule transaction generated. Sign and send via Solana Mobile Wallet Adapter.',
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to build unsigned create tx' },
      { status: 400 }
    )
  }
}

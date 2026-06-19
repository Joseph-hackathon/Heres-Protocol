import { NextRequest, NextResponse } from 'next/server'
import { buildUpdateActivityUnsignedTx } from '@/lib/mobile-tx'
import { ownerBody, firstError } from '@/lib/schemas'

export async function POST(request: NextRequest) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = ownerBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 })
  }

  try {
    const unsigned = await buildUpdateActivityUnsignedTx(parsed.data.owner)

    return NextResponse.json({
      ...unsigned,
      message: 'Unsigned update_activity transaction generated. Sign and send via Solana Mobile Wallet Adapter.',
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to build unsigned update_activity tx' },
      { status: 400 }
    )
  }
}

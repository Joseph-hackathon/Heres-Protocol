import { NextRequest, NextResponse } from 'next/server'
import { buildActivityScore, validateWalletQuery } from '@/lib/mobile'
import { getAddressTransactionsViaRpc } from '@/lib/solana-data'

export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get('wallet')
    const validation = validateWalletQuery(wallet)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const txs = await getAddressTransactionsViaRpc(wallet!, 100)
    const response = buildActivityScore(wallet!, txs)
    return NextResponse.json(response)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to calculate activity score' },
      { status: 500 }
    )
  }
}

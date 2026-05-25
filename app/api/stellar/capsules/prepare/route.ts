import { NextRequest, NextResponse } from 'next/server'
import { parseAssetSymbol, prepareStellarCustodyPayment } from '@/lib/stellar-capsules'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const source = String(body?.source || '').trim()
    const assetSymbol = parseAssetSymbol(body?.assetSymbol)
    const amount = String(body?.amount || '').trim()
    const prepared = await prepareStellarCustodyPayment({ source, assetSymbol, amount })
    return NextResponse.json({ ok: true, ...prepared })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to prepare Stellar custody payment'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

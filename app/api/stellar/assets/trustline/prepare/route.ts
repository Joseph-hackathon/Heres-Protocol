import { NextRequest, NextResponse } from 'next/server'
import { parseAssetSymbol, prepareStellarTrustline } from '@/lib/stellar-capsules'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const source = String(body?.source || '').trim()
    const assetSymbol = parseAssetSymbol(body?.assetSymbol)
    const prepared = await prepareStellarTrustline({ source, assetSymbol })
    return NextResponse.json({ ok: true, ...prepared })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to prepare Stellar trustline'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

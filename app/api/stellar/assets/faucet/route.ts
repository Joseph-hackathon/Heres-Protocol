import { NextRequest, NextResponse } from 'next/server'
import { fundStellarIssuedAsset, parseAssetSymbol } from '@/lib/stellar-capsules'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const destination = String(body?.destination || '').trim()
    const assetSymbol = parseAssetSymbol(body?.assetSymbol)
    const result = await fundStellarIssuedAsset({ destination, assetSymbol })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fund Stellar issued asset'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

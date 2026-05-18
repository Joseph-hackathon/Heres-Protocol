import { NextRequest, NextResponse } from 'next/server'
import { isValidSolanaAddress } from '@/config/solana'
import { getNftAssetsByOwner } from '@/lib/solana-data'
import { getNftAssetsByOwner } from '@/lib/solana-data'

export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get('wallet')?.trim() || ''
    if (!wallet) {
      return NextResponse.json({ error: 'wallet query parameter is required' }, { status: 400 })
    }
    if (!isValidSolanaAddress(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }

    const items = await getNftAssetsByOwner(wallet)
    return NextResponse.json({ items })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch NFTs' },
      { status: 500 }
    )
  }
}

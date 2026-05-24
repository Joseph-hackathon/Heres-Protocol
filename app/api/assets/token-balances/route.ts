import { NextRequest, NextResponse } from 'next/server'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { getSolanaConnection, isValidSolanaAddress } from '@/config/solana'
import { SUPPORTED_TOKEN_ASSETS } from '@/lib/assets'

export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get('wallet')?.trim() || ''
    if (!wallet) {
      return NextResponse.json({ error: 'wallet query parameter is required' }, { status: 400 })
    }
    if (!isValidSolanaAddress(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }

    const owner = new PublicKey(wallet)
    const connection = getSolanaConnection()
    const balances: Record<string, { amount: string; uiAmount: number | null }> = {}
    const solLamports = await connection.getBalance(owner, 'confirmed')
    balances.SOL = {
      amount: String(solLamports),
      uiAmount: solLamports / LAMPORTS_PER_SOL,
    }

    await Promise.all(
      SUPPORTED_TOKEN_ASSETS
        .filter((asset) => !asset.isNative && asset.mint)
        .map(async (asset) => {
          try {
            const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
              mint: new PublicKey(asset.mint as string),
            })
            const uiAmount = accounts.value.reduce((sum, account) => {
              const amount = account.account.data.parsed?.info?.tokenAmount?.uiAmount
              return sum + (typeof amount === 'number' ? amount : 0)
            }, 0)
            const atomicAmount = accounts.value.reduce((sum, account) => {
              const amount = account.account.data.parsed?.info?.tokenAmount?.amount || '0'
              return sum + BigInt(amount)
            }, 0n)
            balances[asset.symbol] = {
              amount: atomicAmount.toString(),
              uiAmount,
            }
          } catch {
            balances[asset.symbol] = { amount: '0', uiAmount: 0 }
          }
        })
    )

    return NextResponse.json({ balances })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch token balances' },
      { status: 500 }
    )
  }
}

import { ALCHEMY_CONFIG, SOLANA_CONFIG } from '@/constants'

export interface AlchemyNftItem {
  mint: string
  name?: string
  symbol?: string
  imageUri?: string
}

export async function getAlchemyAssetsByOwner(ownerAddress: string): Promise<AlchemyNftItem[]> {
  if (!SOLANA_CONFIG.ALCHEMY_API_KEY || !ALCHEMY_CONFIG.RPC_URL) return []

  try {
    const response = await fetch(ALCHEMY_CONFIG.RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAssetsByOwner',
        params: {
          ownerAddress,
          options: {
            showFungible: false,
            showZeroBalance: false,
          },
        },
      }),
    })

    if (!response.ok) return []

    const data = await response.json()
    const result = data?.result
    if (!result || !Array.isArray(result.items)) return []

    return result.items
      .filter((item: any) => item?.interface === 'V1_NFT' || item?.id)
      .map((item: any) => {
        const content = item?.content || {}
        const files = content?.files || []
        const metadata = content?.metadata || {}
        const imageUri = files[0]?.cdn_uri || files[0]?.uri

        return {
          mint: item.id || '',
          name: metadata?.name ?? undefined,
          symbol: metadata?.symbol ?? undefined,
          imageUri: imageUri ?? undefined,
        }
      })
  } catch (error) {
    console.error('Alchemy getAssetsByOwner error:', error)
    return []
  }
}

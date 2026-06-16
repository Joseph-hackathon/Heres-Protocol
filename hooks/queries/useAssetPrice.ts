'use client'

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChartPoint = { time: string; value: number; usd: number }

export interface UseAssetPriceOptions {
  coingeckoId: string
  /** The key string for the current range (e.g. '1d', '6h'). Used as the cache key. */
  rangeKey: string
  /** Number of days to request from CoinGecko market_chart. */
  days: number
  /** If non-null, filter the returned prices to only points within this many hours of now. */
  hoursFilter: number | null
  /** Whether the asset is a fungible token (enables the queries). */
  isToken: boolean
  /** Whether the asset is an NFT (enables the queries). */
  isNft: boolean
}

export interface UseAssetPrice {
  currentSolPrice: number | null
  chartData: ChartPoint[]
  chartLoading: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatChartTime(ts: number, rangeKey: string): string {
  const d = new Date(ts)
  if (rangeKey === '1y') {
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  }
  if (rangeKey === '1mo') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAssetPrice({
  coingeckoId,
  rangeKey,
  days,
  hoursFilter,
  isToken,
  isNft,
}: UseAssetPriceOptions): UseAssetPrice {
  const priceEnabled = Boolean(coingeckoId) && (isToken || isNft)

  // -------------------------------------------------------------------------
  // Current price -- replaces the setInterval polling (Effect 7 equivalent)
  // -------------------------------------------------------------------------
  const currentPriceQuery = useQuery({
    queryKey: queryKeys.price.current(coingeckoId),
    enabled: priceEnabled,
    staleTime: 60_000, // treat data as fresh for 60s; refetch interval carries the update
    refetchInterval: 120_000, // replaces setInterval(fetchPrice, 120_000)
    retry: 0,
    queryFn: async () => {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`
      const res = await fetch(url)
      const data: Record<string, { usd?: number }> = await res.json()
      const usd = data?.[coingeckoId]?.usd
      return typeof usd === 'number' && usd > 0 ? usd : null
    },
  })

  // -------------------------------------------------------------------------
  // Market chart -- replaces Effect 6 (refetches automatically when rangeKey changes)
  // -------------------------------------------------------------------------
  const chartQuery = useQuery({
    queryKey: queryKeys.price.chart(coingeckoId, rangeKey),
    enabled: priceEnabled,
    staleTime: 5 * 60 * 1000,
    retry: 0,
    queryFn: async (): Promise<ChartPoint[]> => {
      const url = `https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}`
      const res = await fetch(url)
      const data: { prices?: [number, number][] } = await res.json()
      let prices = data?.prices || []
      if (hoursFilter != null) {
        const cutoff = Date.now() - hoursFilter * 60 * 60 * 1000
        prices = prices.filter(([ts]) => ts >= cutoff)
      }
      return prices.map(([ts, usd]) => ({
        time: formatChartTime(ts, rangeKey),
        value: usd,
        usd,
      }))
    },
  })

  return {
    currentSolPrice: currentPriceQuery.data ?? null,
    chartData: chartQuery.data ?? [],
    chartLoading: chartQuery.isLoading || chartQuery.isFetching,
  }
}

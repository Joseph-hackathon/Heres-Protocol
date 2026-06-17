'use client'

import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { type DashboardSummary } from './useDashboardData'

// Public, unauthenticated protocol stats for the dashboard. Backed by the
// summary-only endpoint, so no per-owner capsule rows are ever fetched here.

const EMPTY_SUMMARY: DashboardSummary = {
  total: 0,
  active: 0,
  executed: 0,
  expired: 0,
  proofs: 0,
  successRate: 0,
  totalValueSecuredLamports: 0,
  totalValueExecutedLamports: 0,
  activeValueLockedLamports: 0,
  activeAssetTotals: {},
}

export interface UseDashboardSummary {
  summary: DashboardSummary
  lastUpdated: number | null
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
  refresh: () => void
}

export function useDashboardSummary(): UseDashboardSummary {
  const summaryQuery = useQuery({
    queryKey: queryKeys.dashboard.summary(),
    queryFn: async () => {
      const res = await fetch('/api/capsules/summary')
      if (!res.ok) {
        throw new Error(`Summary API failed with ${res.status}`)
      }
      const data = await res.json()
      return {
        summary: { ...EMPTY_SUMMARY, ...(data?.summary ?? {}) } as DashboardSummary,
        timestamp: typeof data?.timestamp === 'number' ? data.timestamp : null,
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const refresh = useCallback(() => {
    summaryQuery.refetch()
  }, [summaryQuery])

  return {
    summary: summaryQuery.data?.summary ?? EMPTY_SUMMARY,
    lastUpdated: summaryQuery.data?.timestamp ?? null,
    isLoading: summaryQuery.isLoading,
    isRefreshing: summaryQuery.isFetching,
    error: summaryQuery.isError ? 'Unable to load protocol stats.' : null,
    refresh,
  }
}

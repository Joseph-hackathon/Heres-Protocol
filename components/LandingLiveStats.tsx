'use client'

import { useEffect, useState } from 'react'

type LandingStats = {
  total: number
  active: number
  executed: number
  totalValueSecuredLamports: number
  assetSummary: string
}

type DashboardResponse = {
  summary?: {
    total?: number
    active?: number
    executed?: number
    totalValueSecuredLamports?: number
    activeAssetTotals?: Record<string, number>
  }
}

const REQUEST_TIMEOUT_MS = 4500

function formatMetricCount(value: number | null) {
  if (value === null) return '--'
  return new Intl.NumberFormat('en-US').format(value)
}

function formatSolAmount(lamports: number | null) {
  if (lamports === null) return '--'
  return (lamports / 1_000_000_000).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: lamports >= 100_000_000_000 ? 0 : 2,
  })
}

function describeAssetMix(activeAssetTotals?: Record<string, number>) {
  const entries = Object.entries(activeAssetTotals || {})
    .filter(([, amount]) => Number(amount) > 0)
    .map(([symbol]) => symbol)

  if (!entries.length) return 'Live metrics available in dashboard'
  return entries.slice(0, 4).join(' / ')
}

function normalizeDashboardStats(data: DashboardResponse): LandingStats {
  const summary = data.summary || {}

  return {
    total: Number(summary.total || 0),
    active: Number(summary.active || 0),
    executed: Number(summary.executed || 0),
    totalValueSecuredLamports: Number(summary.totalValueSecuredLamports || 0),
    assetSummary: describeAssetMix(summary.activeAssetTotals),
  }
}

function useLandingStats() {
  const [stats, setStats] = useState<LandingStats | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    fetch('/api/dashboard?history=0', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Dashboard request failed')
        return response.json() as Promise<DashboardResponse>
      })
      .then((data) => setStats(normalizeDashboardStats(data)))
      .catch(() => {
        setStats({
          total: 0,
          active: 0,
          executed: 0,
          totalValueSecuredLamports: 0,
          assetSummary: 'Dashboard is syncing live network data',
        })
      })
      .finally(() => window.clearTimeout(timeout))

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [])

  return stats
}

export function LandingHeroStats() {
  const stats = useLandingStats()

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="landing-stat-card rounded-[22px] border border-Heres-border/70 bg-black/25 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-Heres-muted">Capsules Created</p>
        <p className="mt-4 text-4xl font-black tracking-tight text-white">{formatMetricCount(stats?.total ?? null)}</p>
      </div>
      <div className="landing-stat-card rounded-[22px] border border-Heres-border/70 bg-black/25 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-Heres-muted">Value Secured</p>
        <p className="mt-4 text-4xl font-black tracking-tight text-Heres-accent">
          {formatSolAmount(stats?.totalValueSecuredLamports ?? null)} SOL
        </p>
      </div>
      <div className="landing-stat-card rounded-[22px] border border-Heres-border/70 bg-black/25 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-Heres-muted">Active Capsules</p>
        <p className="mt-4 text-4xl font-black tracking-tight text-white">{formatMetricCount(stats?.active ?? null)}</p>
      </div>
      <div className="landing-stat-card rounded-[22px] border border-Heres-border/70 bg-black/25 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-Heres-muted">Asset Mix</p>
        <p className="mt-4 text-lg font-semibold leading-7 text-white">
          {stats?.assetSummary || 'Loading live dashboard metrics'}
        </p>
      </div>
    </div>
  )
}

export function LandingSummaryStats() {
  const stats = useLandingStats()

  return (
    <>
      <div className="grid gap-10 border-b border-Heres-border/60 pb-12 md:grid-cols-3">
        <div className="md:border-r md:border-Heres-border/40">
          <p className="text-5xl font-black uppercase tracking-tight text-white">{formatMetricCount(stats?.total ?? null)}</p>
          <p className="mt-3 text-sm uppercase tracking-[0.16em] text-Heres-muted">Capsules Created</p>
        </div>
        <div className="md:border-r md:border-Heres-border/40">
          <p className="text-5xl font-black uppercase tracking-tight text-Heres-accent">
            {formatSolAmount(stats?.totalValueSecuredLamports ?? null)} SOL
          </p>
          <p className="mt-3 text-sm uppercase tracking-[0.16em] text-Heres-muted">Value Secured</p>
        </div>
        <div>
          <p className="text-5xl font-black uppercase tracking-tight text-white">{formatMetricCount(stats?.executed ?? null)}</p>
          <p className="mt-3 text-sm uppercase tracking-[0.16em] text-Heres-muted">Executed Capsules</p>
        </div>
      </div>

      <p className="mx-auto mt-8 max-w-4xl text-sm font-semibold uppercase tracking-[0.16em] text-Heres-accent">
        {stats?.assetSummary || 'Loading live dashboard metrics'}
      </p>
    </>
  )
}

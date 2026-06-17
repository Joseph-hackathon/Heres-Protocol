'use client'

import Link from 'next/link'
import { Plus, RefreshCw, User } from 'lucide-react'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { SOLANA_CONFIG } from '@/constants'
import { type SupportedAssetSymbol } from '@/lib/assets'
import { SectionEyebrow, ServicePageHeader } from '@/components/ui/service-page'
import { Button, AddressPill, StatTile } from '@/components/ui'
import { timeAgo } from '@/lib/format'
import { useDashboardSummary } from '@/hooks/queries/useDashboardSummary'

const formatNumber = (value: number) => value.toLocaleString('en-US')
const formatSolAmount = (lamports: number, fractionDigits = 2) =>
  (lamports / LAMPORTS_PER_SOL).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })
const formatAssetAmount = (value: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })

export default function DashboardPage() {
  const { summary, lastUpdated, isRefreshing, error, refresh } = useDashboardSummary()

  const totalBase = Math.max(summary.total, 1)
  const trackedCapsules = summary.active + summary.executed + summary.expired
  const activeDelta = (summary.active / totalBase) * 100
  const executedDelta = (summary.executed / totalBase) * 100
  const trackedDelta = (trackedCapsules / totalBase) * 100
  const lockedSolDelta =
    summary.totalValueSecuredLamports > 0
      ? (summary.activeValueLockedLamports / summary.totalValueSecuredLamports) * 100
      : 0
  const executedSolDelta =
    summary.totalValueSecuredLamports > 0
      ? (summary.totalValueExecutedLamports / summary.totalValueSecuredLamports) * 100
      : 0
  const activeAssetSummary = Object.entries(summary.activeAssetTotals || {})
    .filter((entry): entry is [SupportedAssetSymbol, number] => Number.isFinite(entry[1]) && entry[1] > 0)
    .sort((a, b) => b[1] - a[1])
  const primaryActiveAsset = activeAssetSummary[0] || null
  const activeAssetDisplay = activeAssetSummary.length
    ? activeAssetSummary.map(([symbol, amount]) => `${formatAssetAmount(amount)} ${symbol}`).join(' · ')
    : `${formatSolAmount(summary.activeValueLockedLamports)} SOL`
  const activeAssetMeta = activeAssetSummary.length > 1
    ? `${activeAssetSummary.length} asset types`
    : primaryActiveAsset
      ? primaryActiveAsset[0]
      : 'SOL'

  const statCards = [
    {
      label: 'All-Time Capsules',
      value: formatNumber(summary.total),
      metaLabel: 'Currently tracked',
      metaValue: formatNumber(trackedCapsules),
      deltaPct: trackedDelta,
      linePath: 'M8 80 C28 18, 54 70, 74 40 S112 28, 132 20',
    },
    {
      label: 'Active Capsules',
      value: formatNumber(summary.active),
      metaLabel: 'Currently locked',
      metaValue: `${formatSolAmount(summary.activeValueLockedLamports)} SOL`,
      deltaPct: activeDelta,
      linePath: 'M8 78 C24 62, 40 44, 58 38 S92 34, 112 20 S126 12, 132 14',
    },
    {
      label: 'Executed Capsules',
      value: formatNumber(summary.executed),
      metaLabel: 'Lifetime transferred',
      metaValue: `${formatSolAmount(summary.totalValueExecutedLamports)} SOL`,
      deltaPct: executedDelta,
      linePath: 'M8 84 C28 66, 42 76, 58 56 S86 32, 100 30 S120 18, 132 12',
    },
    {
      label: 'Active Asset Value',
      value: activeAssetDisplay,
      metaLabel: 'Primary asset',
      metaValue: activeAssetMeta,
      deltaPct: activeAssetSummary.length ? activeDelta : (executedSolDelta || lockedSolDelta),
      linePath: 'M8 84 C26 72, 44 62, 58 44 S84 24, 102 24 S122 16, 132 10',
    },
  ]

  const programIdStr = SOLANA_CONFIG.PROGRAM_ID

  return (
    <div className="min-h-screen bg-hero text-Heres-white">
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {error && (
            <div className="mb-6 rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Aggregate-only protocol stats. No per-owner data is shown here -- a
              user's own capsule lives at /capsules, and the full explorer is admin-only. */}
          <ServicePageHeader
            className="mb-6"
            eyebrow={<SectionEyebrow>Protocol Stats</SectionEyebrow>}
            title="Heres Protocol"
            description="Aggregate activity across the protocol on the active Solana cluster. To manage your own capsule, open My Capsule."
            badges={
              <>
                <span className="rounded-lg border border-Heres-border bg-Heres-surface/80 px-2.5 py-1 text-xs font-medium text-Heres-muted">
                  v1.0
                </span>
                <span className="rounded-lg border border-Heres-border bg-Heres-card/70 px-2.5 py-1 text-xs font-medium text-Heres-accent">
                  {formatNumber(summary.total)} Capsules
                </span>
                <span className="inline-flex items-center gap-2 rounded-lg border border-Heres-border bg-Heres-card/80 px-3 py-1.5 text-xs font-medium text-Heres-muted">
                  <span className="uppercase tracking-wider text-[10px]">Program ID</span>
                  <AddressPill address={programIdStr} explorer="address" copy={false} className="text-Heres-white" />
                </span>
              </>
            }
            actions={
              <>
                <Link
                  href="/capsules"
                  className="inline-flex items-center gap-2 rounded-xl border border-Heres-border bg-Heres-card/80 px-4 py-2 text-sm font-medium text-Heres-muted transition-colors hover:border-Heres-accent/40 hover:text-Heres-accent"
                >
                  <User className="h-4 w-4" />
                  My Capsule
                </Link>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={refresh}
                  disabled={isRefreshing}
                  loading={isRefreshing}
                >
                  {!isRefreshing && <RefreshCw className="h-4 w-4 shrink-0" />}
                  {isRefreshing ? 'Syncing...' : lastUpdated ? `Updated ${timeAgo(lastUpdated)}` : 'Syncing'}
                </Button>
              </>
            }
          />

          {/* Stats row */}
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6">
            {statCards.map((card, index) => (
              <StatTile
                key={card.label}
                label={card.label}
                value={
                  <div>
                    <div className="text-[2.1rem] font-semibold leading-none text-Heres-accent sm:text-[2.35rem]">
                      {card.value}
                    </div>
                    <div className="mt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-Heres-muted/80">
                        {card.metaLabel}
                      </p>
                      <p className="mt-1 text-xl font-semibold text-white/80">{card.metaValue}</p>
                      <p className="mt-1 text-xs text-Heres-muted/80">
                        {lastUpdated ? `Updated ${timeAgo(lastUpdated)}` : 'Updated just now'}
                      </p>
                    </div>
                  </div>
                }
                delta={card.deltaPct}
                sparkline={
                  <div className="dashboard-stat-card__chart shrink-0">
                    <svg viewBox="0 0 140 92" className="h-full w-full" aria-hidden="true">
                      <defs>
                        <filter id={`glow-${index}`}>
                          <feGaussianBlur stdDeviation="2.5" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>
                      <path
                        d={card.linePath}
                        fill="none"
                        stroke="rgba(45, 212, 232, 0.2)"
                        strokeWidth="5"
                        strokeLinecap="round"
                        filter={`url(#glow-${index})`}
                      />
                      <path
                        d={card.linePath}
                        fill="none"
                        stroke="#2DD4E8"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                }
              />
            ))}
          </section>

          {/* Personal entry points -- the dashboard no longer lists individual capsules. */}
          <section className="dashboard-panel p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-Heres-white">Manage your capsule</h2>
                <p className="mt-1 text-sm text-Heres-muted">
                  Capsule details are private to their owner. Open your own capsule or create a new one.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/capsules"
                  className="inline-flex items-center gap-2 rounded-xl border border-Heres-border bg-Heres-card/80 px-4 py-2 text-sm font-medium text-Heres-muted transition-colors hover:border-Heres-accent/40 hover:text-Heres-accent"
                >
                  <User className="h-4 w-4" />
                  My Capsule
                </Link>
                <Link
                  href="/create"
                  className="inline-flex items-center gap-2 rounded-xl bg-Heres-accent px-4 py-2 text-sm font-semibold text-slate-950 transition-opacity hover:opacity-95"
                >
                  <Plus className="h-4 w-4" />
                  Create Capsule
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

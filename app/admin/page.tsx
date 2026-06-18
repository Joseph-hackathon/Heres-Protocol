'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Database,
  RefreshCw,
  Settings,
  ShieldAlert,
  User,
} from 'lucide-react'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useHeresWallet } from '@/hooks/useHeresWallet'
import { SOLANA_CONFIG, getExplorerUrl } from '@/constants'
import { type SupportedAssetSymbol } from '@/lib/assets'
import { SectionEyebrow, ServicePageHeader } from '@/components/ui/service-page'
import {
  Button,
  Card,
  AddressPill,
  StatTile,
  StatusChip,
} from '@/components/ui'
import { timeAgo, formatDateTime } from '@/lib/format'
import { useDashboardData } from '@/hooks/queries/useDashboardData'
import { useAdminAuth } from '@/hooks/useAdminAuth'
import { PrivyLoginButton } from '@/components/PrivyLoginButton'

const formatNumber = (value: number) => value.toLocaleString('en-US')
const formatSolAmount = (lamports: number, fractionDigits = 2) =>
  (lamports / LAMPORTS_PER_SOL).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })
const formatAssetAmount = (value: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })

const formatDuration = (seconds: number | null) => {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '...'
  const days = seconds / (60 * 60 * 24)
  if (days < 1) return `${Math.max(1, Math.round(seconds / 3600))}h`
  if (days < 30) return `${Math.round(days)}d`
  return `${Math.round(days / 30)}mo`
}

function AdminGate({ title, message, children }: { title: string; message: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-hero px-4 pb-16 pt-24">
      <div className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-12">
        <Card className="w-full p-8 text-center sm:p-12">
          <ShieldAlert className="mx-auto mb-6 h-14 w-14 text-brand" aria-hidden />
          <h2 className="mb-3 font-serif text-2xl font-semibold text-vellum">{title}</h2>
          <p className="mb-6 text-ash">{message}</p>
          {children}
        </Card>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const wallet = useHeresWallet()
  const { isAdmin, ensureAuthHeaders } = useAdminAuth()
  const dataEnabled = wallet.connected && isAdmin

  const { capsules, summary, error, lastUpdated, isRefreshing, feeConfigExists, refresh, initFee } =
    useDashboardData({ adminAuthHeaders: ensureAuthHeaders, enabled: dataEnabled })

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'created' | 'executed' | 'active' | 'expired'>('all')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [zkProofHash, setZkProofHash] = useState<string | null>(null)
  const [zkPublicInputsHash, setZkPublicInputsHash] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    // Magicblock PER (TEE) context / commit (fallback to legacy zk keys)
    const erContextKey = 'er_context_global'
    const erCommitKey = 'er_commit_hash_global'
    const legacyProofKey = 'zk_proof_hash_global'
    const legacyInputsKey = 'zk_inputs_hash_global'
    setZkProofHash(localStorage.getItem(erContextKey) || localStorage.getItem(legacyProofKey))
    setZkPublicInputsHash(localStorage.getItem(erCommitKey) || localStorage.getItem(legacyInputsKey))
  }, [])

  const filteredCapsules = useMemo(() => {
    const value = query.trim().toLowerCase()
    const scoped = capsules.filter((capsule) => {
      if (filterMode === 'created' && capsule.status !== 'Created') return false
      if (filterMode === 'executed' && capsule.status !== 'Executed') return false
      if (filterMode === 'active' && capsule.status !== 'Active') return false
      if (filterMode === 'expired' && capsule.status !== 'Expired') return false
      if (!value) return true
      return (
        capsule.capsuleAddress.toLowerCase().includes(value) ||
        capsule.owner?.toLowerCase().includes(value) ||
        capsule.signature?.toLowerCase().includes(value)
      )
    })
    const sorted = scoped.sort((a, b) => {
      const aTime = a.lastActivityMs || a.executedAtMs || 0
      const bTime = b.lastActivityMs || b.executedAtMs || 0
      return sortOrder === 'newest' ? bTime - aTime : aTime - bTime
    })
    return sorted
  }, [capsules, filterMode, query, sortOrder])

  useEffect(() => {
    setCurrentPage(1)
  }, [filterMode, query, sortOrder])

  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(filteredCapsules.length / pageSize))
  const pageStart = (currentPage - 1) * pageSize
  const pagedCapsules = filteredCapsules.slice(pageStart, pageStart + pageSize)

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

  // Access gates: cosmetic here, enforced server-side on every data request.
  if (!wallet.connected) {
    return (
      <AdminGate title="Admin Access" message="Sign in with an allowlisted admin wallet to open the protocol explorer.">
        <div className="wallet-menu-container flex justify-center">
          <PrivyLoginButton />
        </div>
      </AdminGate>
    )
  }

  if (!isAdmin) {
    return (
      <AdminGate
        title="Not Authorized"
        message="This wallet is not on the admin allowlist. Switch to an authorized wallet to continue."
      >
        <Link
          href="/capsules"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-hair bg-card px-4 py-3 text-sm font-medium text-ash transition-colors hover:border-brand/40 hover:text-brand"
        >
          Go to My Capsule
        </Link>
      </AdminGate>
    )
  }

  return (
    <div className="min-h-screen bg-hero text-Heres-white">
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {error && (
            <div className="mb-6 rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Explorer-style: single header card (name + version + stats + Updated) */}
          <ServicePageHeader
            className="mb-6"
            eyebrow={<SectionEyebrow>Admin Explorer</SectionEyebrow>}
            title="Protocol Explorer"
            description="Admin-only view of every capsule: status, PER (TEE) execution, and verification on the active Solana cluster."
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

          {/* Fee config setup (admin one-time): shown only when no fee config exists */}
          {feeConfigExists === false && (
            <section className="dashboard-panel p-6 mb-6 border-Heres-accent/20">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-Heres-accent/10 border border-Heres-accent/40 flex items-center justify-center">
                    <Settings className="w-5 h-5 text-Heres-accent" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-Heres-white">Fee Config Setup</h2>
                    <p className="text-sm text-Heres-muted mt-0.5">
                      No fee config found. Run once to initialize. Create 0.05 SOL, execute 3%.
                    </p>
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={initFee.run}
                  disabled={initFee.pending}
                  loading={initFee.pending}
                >
                  {initFee.pending ? 'Processing...' : 'Initialize Fee Config'}
                </Button>
              </div>
              {initFee.tx && (
                <p className="mt-3 text-sm text-Heres-accent">
                  Success:{' '}
                  <a
                    href={getExplorerUrl('tx', initFee.tx)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    View transaction
                  </a>
                </p>
              )}
              {initFee.error && (
                <p className="mt-3 text-sm text-amber-400">{initFee.error}</p>
              )}
            </section>
          )}

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

          {/* Explorer-style: tab bar + content */}
          <section className="dashboard-panel dashboard-panel--table overflow-hidden">
            {/* Tab bar - Explorer "Query | Curators" style */}
            <div className="border-b border-Heres-border/70 bg-Heres-surface/25">
              <div className="flex flex-wrap gap-0 overflow-x-auto">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'created', label: 'Created' },
                  { key: 'executed', label: 'Executed' },
                  { key: 'active', label: 'Active' },
                  { key: 'expired', label: 'Expired' },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setFilterMode(option.key as typeof filterMode)}
                    className={`min-w-[80px] px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${filterMode === option.key
                      ? 'border-Heres-accent text-Heres-accent bg-Heres-accent/[0.04]'
                      : 'border-transparent text-Heres-muted hover:text-Heres-white hover:bg-Heres-card/40'
                      }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                <div className="flex items-center gap-2 text-sm text-Heres-muted">
                  <Database className="w-4 h-4 text-Heres-accent" />
                  {formatNumber(filteredCapsules.length)} records
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by address, owner, or signature"
                    className="w-full sm:w-72 rounded-lg border border-Heres-border bg-Heres-surface/80 px-3 py-2 text-sm text-Heres-white placeholder-Heres-muted focus:outline-none focus:border-Heres-accent/50 transition"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSortOrder(sortOrder === 'newest' ? 'oldest' : 'newest')}
                  >
                    {sortOrder === 'newest' ? 'Newest' : 'Oldest'}
                  </Button>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {filteredCapsules.length === 0 && (
                  <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 px-4 py-8 text-center text-sm text-Heres-muted">
                    No capsules found. Try syncing again or adjust the search query.
                  </div>
                )}

                {pagedCapsules.map((capsule) => (
                  <div
                    key={capsule.id}
                    className={`rounded-xl border px-4 py-4 transition-colors ${capsule.kind === 'event'
                      ? 'border-Heres-accent/30 bg-Heres-accent/5'
                      : 'border-Heres-border bg-Heres-card/50'
                      }`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3 text-sm text-Heres-muted">
                          <span className="rounded-lg border border-Heres-border bg-Heres-surface/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-Heres-muted">
                            {capsule.kind === 'event' ? 'Event' : 'Capsule'}
                          </span>
                          <StatusChip status={capsule.status} />
                          {capsule.signature ? (
                            <AddressPill address={capsule.signature} explorer="tx" className="min-w-0 max-w-full" />
                          ) : (
                            <span className="font-mono text-Heres-muted">...</span>
                          )}
                        </div>
                        <div className="grid gap-2 text-xs text-Heres-muted md:grid-cols-3">
                          <div>
                            <p className="uppercase tracking-wider text-Heres-muted text-[10px] font-medium">Capsule</p>
                            <AddressPill address={capsule.capsuleAddress} explorer="address" />
                          </div>
                          <div>
                            <p className="uppercase tracking-wider text-Heres-muted text-[10px] font-medium">Owner</p>
                            {capsule.owner ? (
                              <AddressPill address={capsule.owner} explorer="address" />
                            ) : (
                              <span className="font-mono text-Heres-muted">...</span>
                            )}
                          </div>
                          <div>
                            <p className="uppercase tracking-wider text-Heres-muted text-[10px] font-medium">
                              {capsule.kind === 'event' ? 'Created' : 'Inactivity'}
                            </p>
                            <p className="text-Heres-white">
                              {capsule.kind === 'event'
                                ? timeAgo(capsule.lastActivityMs)
                                : formatDuration(capsule.inactivitySeconds)}
                            </p>
                          </div>
                        </div>
                        {capsule.kind === 'event' && (capsule.tokenDelta != null || capsule.solDelta != null || capsule.proofBytes != null) && (
                          <div className="flex flex-wrap gap-3 text-[11px] text-Heres-muted">
                            {capsule.tokenDelta != null && (
                              <span className="font-mono">Token delta: {capsule.tokenDelta}</span>
                            )}
                            {capsule.solDelta != null && (
                              <span className="font-mono">SOL delta: {capsule.solDelta.toFixed(4)}</span>
                            )}
                            {capsule.proofBytes != null && (
                              <span>PER (TEE) tx: {capsule.proofBytes} bytes</span>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedId(expandedId === capsule.id ? null : capsule.id)}
                      >
                        Details
                        {expandedId === capsule.id ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </Button>
                    </div>

                    {expandedId === capsule.id && (
                      <div className="mt-4 w-full min-w-0 rounded-xl border border-Heres-border bg-Heres-surface/80 px-4 py-4 text-xs text-Heres-muted space-y-4 overflow-hidden">
                        <div className="grid gap-3 md:grid-cols-2 max-w-full">
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">Capsule</p>
                            <AddressPill address={capsule.capsuleAddress} explorer="address" />
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">Owner</p>
                            {capsule.owner ? (
                              <AddressPill address={capsule.owner} explorer="address" />
                            ) : (
                              <span className="font-mono text-Heres-muted">...</span>
                            )}
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">Last Activity</p>
                            <p className="text-Heres-white">{formatDateTime(capsule.lastActivityMs)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">Executed At</p>
                            <p className="text-Heres-white">{formatDateTime(capsule.executedAtMs)}</p>
                          </div>
                          {capsule.kind === 'capsule' ? (
                            <>
                              <div>
                                <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">Inactivity Seconds</p>
                                <p className="text-Heres-white">{capsule.inactivitySeconds || '...'}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">Payload Size</p>
                                <p className="text-Heres-white">{capsule.payloadSize ? `${capsule.payloadSize} bytes` : '...'}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">Is Active</p>
                                <p className="text-Heres-white">{capsule.isActive == null ? '...' : capsule.isActive ? 'Yes' : 'No'}</p>
                              </div>
                            </>
                          ) : (
                            <>
                              <div>
                                <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">Token Delta</p>
                                <p className="text-Heres-white">{capsule.tokenDelta || '...'}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">SOL Delta</p>
                                <p className="text-Heres-white">{capsule.solDelta == null ? '...' : `${capsule.solDelta.toFixed(4)} SOL`}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">PER (TEE) Tx Bytes</p>
                                <p className="text-Heres-white">{capsule.proofBytes ? `${capsule.proofBytes} bytes` : '...'}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">PER (TEE) Context</p>
                                {zkProofHash ? (
                                  <AddressPill address={zkProofHash} explorer={false} />
                                ) : (
                                  <span className="font-mono text-Heres-muted">...</span>
                                )}
                              </div>
                              <div>
                                <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">PER (TEE) Commit Hash</p>
                                {zkPublicInputsHash ? (
                                  <AddressPill address={zkPublicInputsHash} explorer={false} />
                                ) : (
                                  <span className="font-mono text-Heres-muted">...</span>
                                )}
                              </div>
                            </>
                          )}
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">Latest Signature</p>
                            {capsule.signature ? (
                              <AddressPill address={capsule.signature} explorer="tx" />
                            ) : (
                              <span className="font-mono text-Heres-muted">...</span>
                            )}
                          </div>
                        </div>

                        <div>
                          <p className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted mb-2">
                            Capsule Events
                          </p>
                          {capsule.events.length === 0 ? (
                            <p className="text-Heres-muted">No transaction events found for this capsule.</p>
                          ) : (
                            <div className="space-y-2">
                              {capsule.events.map((event) => (
                                <div
                                  key={`${capsule.id}-${event.signature}`}
                                  className="rounded-lg border border-Heres-border bg-Heres-card/80 px-3 py-3"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-Heres-white">{event.label}</span>
                                    <span className="text-[10px] text-Heres-muted">
                                      {event.blockTime ? timeAgo(event.blockTime * 1000) : '...'}
                                    </span>
                                  </div>
                                  <div className="mt-2 flex items-start justify-between gap-2 text-[11px] text-Heres-muted">
                                    <AddressPill address={event.signature} explorer="tx" className="min-w-0" />
                                    <StatusChip status={event.status === 'success' ? 'executed' : 'failed'} className="shrink-0" />
                                  </div>
                                  {event.logs.length > 0 && (
                                    <div className="mt-2 max-h-48 overflow-y-auto space-y-1 text-[11px] text-Heres-muted font-mono break-all whitespace-pre-wrap overflow-x-hidden">
                                      {event.logs.map((log, index) => (
                                        <div key={`${event.signature}-${index}`}>{log}</div>
                                      ))}
                                      <p className="text-[10px] text-Heres-muted pt-1">
                                        {event.logs.length} log{event.logs.length !== 1 ? 's' : ''} total
                                      </p>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {filteredCapsules.length > pageSize && (
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-Heres-muted">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    First
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="rounded-lg border border-Heres-border bg-Heres-card/80 px-3 py-1.5 text-Heres-white">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage >= totalPages}
                  >
                    Last
                  </Button>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

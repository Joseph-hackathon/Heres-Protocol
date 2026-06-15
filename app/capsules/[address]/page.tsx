'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { PublicKey } from '@solana/web3.js'
import { useWallet } from '@solana/wallet-adapter-react'
import { Check, RefreshCw, Shield } from 'lucide-react'
import {
  getCapsuleByAddress,
  executeIntent,
  distributeAssets,
  undelegateCapsule,
  recoverVault,
  cancelCapsule,
  registerCapsuleOwnerForAutomation,
} from '@/lib/solana'
import { getOrMintTeeToken, getCachedTeeToken } from '@/lib/tee'
import { getCapsuleVaultPDA } from '@/lib/program'
import { getVaultTokenAccounts } from '@/lib/spl'
import { getProgramId, getSolanaConnection } from '@/config/solana'
import { SOLANA_CONFIG, MAGICBLOCK_ER, PER_TEE, getExplorerUrl, getNetworkDisplayLabel } from '@/constants'
import { formatDuration } from '@/utils/intent'
import { buildCreSignedMessage } from '@/utils/creAuth'
import { bytesToBase64 } from '@/utils/creCrypto'
import { inferAssetConfig } from '@/lib/assets'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts'
import { SectionEyebrow, ServiceMetaCard, ServiceMetaGrid, ServicePageHeader, ServiceSection } from '@/components/ui/service-page'
import {
  Button,
  CopyButton,
  StatusChip,
  AddressPill,
  ConfirmDialog,
  useToast,
} from '@/components/ui'
import { maskAddress, timeAgo } from '@/lib/format'
import { normalizeTxError } from '@/lib/errors'

const CHART_RANGES = [
  { key: '6h', label: '6h', days: 1, hoursFilter: 6 },
  { key: '12h', label: '12h', days: 1, hoursFilter: 12 },
  { key: '1d', label: '1D', days: 1, hoursFilter: null },
  { key: '1mo', label: '1M', days: 30, hoursFilter: null },
  { key: '1y', label: '1Y', days: 365, hoursFilter: null },
] as const

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

type IntentParsed =
  | {
    type: 'token'
    intent?: string
    totalAmount?: string
    assetSymbol?: string
    assetMint?: string | null
    beneficiaries?: any[]
    inactivityDays?: number
    delayDays?: number
    cre?: {
      enabled?: boolean
      secretRef?: string
      secretHash?: string
      recipientEmailHash?: string
      recipientEmail?: string
      deliveryChannel?: 'email' | 'sms'
    }
    // Legacy payload key support
    premium?: {
      enabled?: boolean
      secretRef?: string
      secretHash?: string
      recipientEmailHash?: string
      recipientEmail?: string
      deliveryChannel?: 'email' | 'sms'
    }
  }
  | {
    type: 'nft'
    intent?: string
    nftMints?: string[]
    nftRecipients?: string[]
    assetSymbol?: string
    assetMint?: string | null
    inactivityDays?: number
    delayDays?: number
    cre?: {
      enabled?: boolean
      secretRef?: string
      secretHash?: string
      recipientEmailHash?: string
      recipientEmail?: string
      deliveryChannel?: 'email' | 'sms'
    }
    // Legacy payload key support
    premium?: {
      enabled?: boolean
      secretRef?: string
      secretHash?: string
      recipientEmailHash?: string
      recipientEmail?: string
      deliveryChannel?: 'email' | 'sms'
    }
  }

export default function CapsuleDetailPage() {
  const params = useParams()
  const router = useRouter()
  const wallet = useWallet()
  const { toast } = useToast()
  const address = typeof params?.address === 'string' ? params.address : null
  const [capsule, setCapsule] = useState<Awaited<ReturnType<typeof getCapsuleByAddress>>>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chartData, setChartData] = useState<{ time: string; value: number; usd: number }[]>([])
  const [chartLoading, setChartLoading] = useState(true)
  const [chartRange, setChartRange] = useState<(typeof CHART_RANGES)[number]['key']>('1d')
  const [currentSolPrice, setCurrentSolPrice] = useState<number | null>(null)
  const [displayedSolPrice, setDisplayedSolPrice] = useState<number>(0)
  const displayedPriceRef = useRef(0)
  const [creDeliveryStatus, setCreDeliveryStatus] = useState<{
    status: string
    updatedAt: number
    idempotencyKey: string
    lastError?: string
  } | null>(null)
  const [creDeliveryLoading, setCreDeliveryLoading] = useState(false)
  const [creDeliveryError, setCreDeliveryError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [creDispatchLoading, setCreDispatchLoading] = useState(false)
  const [creDispatchResult, setCreDispatchResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [distributionComplete, setDistributionComplete] = useState(false)
  // Off-chain capsule metadata (intent statement + CRE config + asset hints). The lean on-chain
  // capsule stores only beneficiaries; the human-facing payload lives off-chain (CRE), so we fetch it
  // best-effort for display. Missing fields simply hide their UI.
  const [meta, setMeta] = useState<IntentParsed | null>(null)
  // The mint actually locked in the vault (source of truth for recover/cancel). Read from chain - the
  // vault is never delegated - so it works for ANY token the capsule holds (classic SPL or Token-2022).
  // null = SOL-only vault. The SDK resolves the token program from the mint.
  const [vaultSplMint, setVaultSplMint] = useState<PublicKey | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)

  // ConfirmDialog open state for destructive actions
  const [confirmRecover, setConfirmRecover] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmUndelegate, setConfirmUndelegate] = useState(false)

  const isOwner = Boolean(wallet.connected && wallet.publicKey && capsule?.owner && capsule.owner.equals(wallet.publicKey))

  const handleExecuteIntent = async () => {
    if (!wallet.connected || !wallet.publicKey || !capsule) return
    setActionLoading('execute')
    setActionResult(null)
    try {
      // Lean execute_intent is state-only and permissionless; beneficiaries live on-chain and are read
      // by distribute_assets, so nothing extra is passed here.
      const tx = await executeIntent(wallet as any, capsule.owner)
      setActionResult({ type: 'success', message: `Execute Intent TX: ${tx}` })
      toast({ message: 'Execute Intent submitted successfully.', variant: 'success' })
    } catch (err: any) {
      console.error('[Execute Intent] Error:', err)
      const msg = normalizeTxError(err)
      setActionResult({ type: 'error', message: err.message || 'Execute failed' })
      toast({ message: msg, variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleDistributeAssets = async () => {
    if (!wallet.connected || !wallet.publicKey || !capsule) return
    setActionLoading('distribute')
    setActionResult(null)
    try {
      if (!capsule.beneficiaries.length) throw new Error('Capsule has no beneficiaries set')
      // Beneficiaries + shares are read from the on-chain capsule; distribute splits every vault asset
      // by share_bps (SPL legs first, then the SOL leg).
      const tx = await distributeAssets(wallet as any, capsule.owner, capsule.beneficiaries)
      setDistributionComplete(true)
      setActionResult({ type: 'success', message: `Distribute Assets TX: ${tx}` })
      toast({ message: 'Assets distributed to beneficiaries.', variant: 'success' })
    } catch (err: any) {
      console.error('[Distribute Assets] Error:', err)
      const msg = normalizeTxError(err)
      setActionResult({ type: 'error', message: err.message || 'Distribution failed' })
      toast({ message: msg, variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleUndelegate = async () => {
    if (!wallet.connected || !wallet.publicKey || !capsule) return
    setActionLoading('undelegate')
    setActionResult(null)
    try {
      // The two-step undelegate reveals the private BeneficiarySet from the TEE, which needs the
      // owner's auth token; reuse the session token (minted once) so there's no extra signMessage.
      const token = await getOrMintTeeToken(wallet as any)
      const tx = await undelegateCapsule(wallet as any, capsule.owner, token)
      const refreshed = await getCapsuleByAddress(new PublicKey(capsule.capsuleAddress), token)
      setCapsule(refreshed)
      setActionResult({ type: 'success', message: `Undelegate TX: ${tx}` })
      toast({ message: 'Capsule undelegated from Ephemeral Rollup.', variant: 'success' })
    } catch (err: any) {
      console.error('[Undelegate] Error:', err)
      const msg = normalizeTxError(err)
      setActionResult({ type: 'error', message: err.message || 'Undelegation failed' })
      toast({ message: msg, variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  // Owner escape hatch: pull all funds out of the Vault back to the wallet. Works even while the
  // Switch is delegated (the Vault is never delegated). The capsule stays active and armed.
  const handleRecoverVault = async () => {
    if (!wallet.connected || !wallet.publicKey || !capsule) return
    setActionLoading('recover')
    setActionResult(null)
    try {
      const mint = vaultSplMint ?? undefined
      const tx = await recoverVault(wallet as any, capsule.owner, mint)
      // Refresh with the cached token only (don't force a signMessage just to refresh the balance).
      const refreshed = await getCapsuleByAddress(new PublicKey(capsule.capsuleAddress), getCachedTeeToken(capsule.owner) ?? undefined)
      if (refreshed) setCapsule(refreshed)
      setActionResult({ type: 'success', message: `Funds withdrawn to your wallet. TX: ${tx}` })
      toast({ message: 'Funds withdrawn to your wallet.', variant: 'success' })
    } catch (err: any) {
      console.error('[Recover Vault] Error:', err)
      const msg = normalizeTxError(err)
      setActionResult({ type: 'error', message: err.message || 'Withdrawal failed' })
      toast({ message: msg, variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  // Owner teardown: refund all funds + reclaim account rent, then permanently close the capsule.
  // Needs the Switch + BeneficiarySet undelegated to base first (Anchor's owner-check rejects a
  // still-delegated account), so the button is gated on !isDelegated - undelegate from ER first.
  const handleCancelCapsule = async () => {
    if (!wallet.connected || !wallet.publicKey || !capsule) return
    setActionLoading('cancel')
    setActionResult(null)
    try {
      const mint = vaultSplMint ?? undefined
      const tx = await cancelCapsule(wallet as any, mint)
      setActionResult({ type: 'success', message: `Capsule cancelled and assets reclaimed. TX: ${tx}` })
      toast({ message: 'Capsule cancelled and assets reclaimed.', variant: 'success' })
      // The accounts are now closed; send the owner back to the list.
      setTimeout(() => router.push('/capsules'), 2500)
    } catch (err: any) {
      console.error('[Cancel Capsule] Error:', err)
      const msg = normalizeTxError(err)
      setActionResult({ type: 'error', message: err.message || 'Cancel failed' })
      toast({ message: msg, variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleRefreshAutomation = async () => {
    if (!wallet.connected || !wallet.publicKey || !capsule) return
    setActionLoading('automation')
    setActionResult(null)
    try {
      await registerCapsuleOwnerForAutomation(capsule.owner.toBase58())
      setActionResult({
        type: 'success',
        message: 'Automation registry refreshed. The next external cron run should be able to discover this capsule.',
      })
      toast({ message: 'Automation registry refreshed.', variant: 'success' })
    } catch (err: any) {
      console.error('[Automation Refresh] Error:', err)
      const msg = normalizeTxError(err)
      setActionResult({
        type: 'error',
        message: err.message || 'Failed to refresh automation registry',
      })
      toast({ message: msg, variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleCreDispatch = async () => {
    if (!wallet.connected || !wallet.publicKey || !capsule || !wallet.signMessage) return
    setCreDispatchLoading(true)
    setCreDispatchResult(null)
    try {
      const owner = wallet.publicKey.toBase58()
      const timestamp = Date.now()
      const message = buildCreSignedMessage({
        action: 'dispatch',
        owner,
        capsuleAddress: capsule.capsuleAddress,
        timestamp,
      })
      const signature = bytesToBase64(await wallet.signMessage(new TextEncoder().encode(message)))
      const res = await fetch('/api/intent-delivery/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cre-signature': signature },
        body: JSON.stringify({ capsule: capsule.capsuleAddress, owner, timestamp }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'CRE dispatch failed')
      setCreDispatchResult({ type: 'success', message: `Intent Statement delivery dispatched (${data.status || 'queued'})` })
      toast({ message: 'Intent Statement delivery dispatched.', variant: 'success' })
    } catch (err: any) {
      const msg = normalizeTxError(err)
      setCreDispatchResult({ type: 'error', message: err.message || 'CRE dispatch failed' })
      toast({ message: msg, variant: 'error' })
    } finally {
      setCreDispatchLoading(false)
    }
  }

  const intentParsed = meta
  const isNft = meta?.type === 'nft'
  const isToken = !isNft
  const assetConfig = inferAssetConfig(meta ?? undefined)
  const priceChartBaseUrl = `https://api.coingecko.com/api/v3/coins/${assetConfig.coingeckoId}/market_chart?vs_currency=usd&days=`
  const priceLookupUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${assetConfig.coingeckoId}&vs_currencies=usd`
  const creConfig = intentParsed?.cre ?? intentParsed?.premium
  const isCreEnabled = Boolean(
    creConfig?.enabled &&
    creConfig.secretRef &&
    creConfig.secretHash &&
    (creConfig.recipientEmailHash || creConfig.recipientEmail)
  )

  useEffect(() => {
    if (!address) {
      setError('Invalid capsule address')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    try {
      const pubkey = new PublicKey(address)
      // Seed with a TEE token already cached for the connected wallet this session (e.g. minted during
      // creation), so an owner sees live private state on first load without a fresh signMessage.
      const cachedToken = wallet.publicKey ? getCachedTeeToken(wallet.publicKey) : undefined
      getCapsuleByAddress(pubkey, cachedToken).then((data) => {
        if (cancelled) return
        setCapsule(data)
        if (!data) setError('Capsule not found')
        setLoading(false)
      }).catch(() => {
        if (!cancelled) {
          setError('Failed to load capsule')
          setLoading(false)
        }
      })
    } catch {
      setError('Invalid capsule address')
      setLoading(false)
    }
    return () => { cancelled = true }
  }, [address])

  // Best-effort off-chain metadata (intent statement + CRE config). Decoupled from the on-chain
  // capsule; failures are non-fatal and just leave the display fields empty.
  useEffect(() => {
    if (!address) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/capsules/${encodeURIComponent(address)}`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const m = (data?.meta ?? data) as Record<string, any>
        setMeta({
          type: m?.type === 'nft' ? 'nft' : 'token',
          intent: m?.intent,
          totalAmount: m?.totalAmount,
          assetSymbol: m?.assetSymbol,
          assetMint: m?.assetMint ?? null,
          nftMints: m?.nftMints,
          cre: m?.cre ?? m?.premium,
        } as IntentParsed)
      } catch {
        // ignore - metadata is optional
      }
    })()
    return () => { cancelled = true }
  }, [address])

  // Discover the SPL asset locked in the vault (if any) straight from chain, so recover/cancel target
  // the real mint regardless of off-chain metadata. Single-asset model: take the first non-zero token.
  useEffect(() => {
    const owner = capsule?.owner
    if (!owner) {
      setVaultSplMint(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const [vaultPDA] = getCapsuleVaultPDA(owner)
        const tokens = await getVaultTokenAccounts(getSolanaConnection(), vaultPDA)
        const held = tokens.find((t) => t.amount > 0n)
        if (!cancelled) setVaultSplMint(held ? held.mint : null)
      } catch {
        if (!cancelled) setVaultSplMint(null)
      }
    })()
    return () => { cancelled = true }
  }, [capsule?.owner?.toBase58()])

  useEffect(() => {
    if (!capsule?.owner || !capsule.executedAt) {
      setDistributionComplete(false)
      return
    }

    const isDelegated = capsule.accountOwner?.equals?.(new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)) ?? false
    if (isDelegated) {
      setDistributionComplete(false)
      return
    }

    let cancelled = false

    ; (async () => {
      try {
        const connection = getSolanaConnection()
        const [vaultPDA] = getCapsuleVaultPDA(capsule.owner)
        // Lean vault holds SOL plus any number of SPL token accounts. "Distributed" = no spendable SOL
        // above rent AND every token account drained.
        const [vaultInfo, rentExemptLamports, tokenAccts] = await Promise.all([
          connection.getAccountInfo(vaultPDA),
          connection.getMinimumBalanceForRentExemption(9),
          connection
            .getParsedTokenAccountsByOwner(vaultPDA, {
              programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            })
            .catch(() => null),
        ])
        const spendableLamports = Math.max(0, (vaultInfo?.lamports || 0) - rentExemptLamports)
        const tokensDrained =
          !tokenAccts ||
          tokenAccts.value.every(
            (t: any) => Number(t.account.data?.parsed?.info?.tokenAmount?.amount || '0') === 0
          )
        if (!cancelled) setDistributionComplete(spendableLamports === 0 && tokensDrained)
      } catch {
        if (!cancelled) {
          setDistributionComplete(false)
        }
      }
    })()

    return () => { cancelled = true }
  }, [capsule?.owner, capsule?.executedAt, capsule?.accountOwner])

  useEffect(() => {
    if (
      !capsule?.capsuleAddress ||
      !isCreEnabled ||
      !wallet.connected ||
      !wallet.publicKey ||
      !wallet.signMessage ||
      !isOwner
    ) {
      setCreDeliveryStatus(null)
      setCreDeliveryError(null)
      return
    }

    let cancelled = false
    setCreDeliveryLoading(true)
    setCreDeliveryError(null)
    const walletPublicKey = wallet.publicKey
    if (!walletPublicKey) {
      setCreDeliveryLoading(false)
      setCreDeliveryError('Wallet public key is unavailable.')
      return
    }
    const signMessage = wallet.signMessage
    if (!signMessage) {
      setCreDeliveryLoading(false)
      setCreDeliveryError('Wallet does not support message signing for Intent Statement delivery status lookup.')
      return
    }

    ; (async () => {
      try {
        const owner = walletPublicKey.toBase58()
        const cacheKey = `cre-status-auth:${capsule.capsuleAddress}:${owner}`
        let timestamp = 0
        let signature = ''

        try {
          const cachedRaw = sessionStorage.getItem(cacheKey)
          if (cachedRaw) {
            const cached = JSON.parse(cachedRaw) as { timestamp?: number; signature?: string }
            if (typeof cached.timestamp === 'number' && typeof cached.signature === 'string') {
              const ageMs = Date.now() - cached.timestamp
              if (ageMs >= 0 && ageMs < 4 * 60 * 1000) {
                timestamp = cached.timestamp
                signature = cached.signature
              }
            }
          }
        } catch {
          // Ignore cache parse failures and request a fresh signature.
        }

        if (!signature) {
          timestamp = Date.now()
          const message = buildCreSignedMessage({
            action: 'delivery-status',
            owner,
            capsuleAddress: capsule.capsuleAddress,
            timestamp,
          })
          signature = bytesToBase64(await signMessage(new TextEncoder().encode(message)))
          sessionStorage.setItem(cacheKey, JSON.stringify({ timestamp, signature }))
        }

        const params = new URLSearchParams({
          capsule: capsule.capsuleAddress,
          owner,
          timestamp: String(timestamp),
        })
        const res = await fetch(`/api/intent-delivery/status?${params.toString()}`, {
          headers: { 'x-cre-signature': signature },
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to fetch Intent Statement delivery status')
        }
        if (cancelled) return
        const latest = Array.isArray(data.entries) ? data.entries[0] : null
        setCreDeliveryStatus(latest ?? null)
      } catch (err) {
        if (cancelled) return
        setCreDeliveryError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setCreDeliveryLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [capsule?.capsuleAddress, isCreEnabled, wallet.connected, wallet.publicKey, wallet.signMessage, isOwner])

  // Token price chart from CoinGecko (with range filter)
  const rangeConfig = useMemo(() => CHART_RANGES.find((r) => r.key === chartRange) ?? CHART_RANGES[2], [chartRange])
  useEffect(() => {
    if (!isToken && !isNft) {
      setChartLoading(false)
      return
    }
    setChartLoading(true)
    const url = `${priceChartBaseUrl}${rangeConfig.days}`
    fetch(url)
      .then((res) => res.json())
      .then((data: { prices?: [number, number][] }) => {
        let prices = data?.prices || []
        if (rangeConfig.hoursFilter != null) {
          const cutoff = Date.now() - rangeConfig.hoursFilter * 60 * 60 * 1000
          prices = prices.filter(([ts]) => ts >= cutoff)
        }
        const mapped = prices.map(([ts, usd]) => ({
          time: formatChartTime(ts, rangeConfig.key),
          value: usd,
          usd,
        }))
        setChartData(mapped)
      })
      .catch(() => setChartData([]))
      .finally(() => setChartLoading(false))
  }, [isToken, isNft, priceChartBaseUrl, chartRange, rangeConfig.days, rangeConfig.hoursFilter, rangeConfig.key])

  // Current asset price (live) and polling
  useEffect(() => {
    if (!isToken && !isNft) return
    const fetchPrice = () => {
      fetch(priceLookupUrl)
        .then((res) => res.json())
        .then((data: Record<string, { usd?: number }>) => {
          const usd = data?.[assetConfig.coingeckoId]?.usd
          if (typeof usd === 'number' && usd > 0) setCurrentSolPrice(usd)
        })
        .catch(() => { })
    }
    fetchPrice()
    const interval = setInterval(fetchPrice, 120_000)
    return () => clearInterval(interval)
  }, [assetConfig.coingeckoId, isToken, isNft, priceLookupUrl])

  // Keep ref in sync for animation start value
  displayedPriceRef.current = displayedSolPrice

  // Animate displayed price towards current price (counting animation)
  useEffect(() => {
    if (currentSolPrice == null) return
    const start = displayedPriceRef.current
    const diff = currentSolPrice - start
    if (Math.abs(diff) < 0.001) {
      setDisplayedSolPrice(currentSolPrice)
      return
    }
    const duration = 500
    const startTime = performance.now()
    let rafId: number
    const tick = (now: number) => {
      const elapsed = now - startTime
      const t = Math.min(elapsed / duration, 1)
      const ease = 1 - Math.pow(1 - t, 2)
      const value = start + diff * ease
      setDisplayedSolPrice(value)
      displayedPriceRef.current = value
      if (t < 1) rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [currentSolPrice])

  if (loading) {
    return (
      <div className="min-h-screen bg-hero text-Heres-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-8 w-8 animate-spin text-Heres-accent" />
          <p className="text-Heres-muted">Loading capsule...</p>
        </div>
      </div>
    )
  }

  if (error || !capsule) {
    return (
      <div className="min-h-screen bg-hero text-Heres-white pt-24 pb-16 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-red-400 mb-6">{error || 'Capsule not found'}</p>
          <Link
            href="/capsules"
            className="inline-flex items-center gap-2 rounded-lg border border-Heres-border bg-Heres-card/80 px-4 py-2 text-Heres-white hover:border-Heres-accent/40"
          >
            My Capsule
          </Link>
        </div>
      </div>
    )
  }

  // Effective due time = the earlier of the inactivity deadline and the optional fixed target date.
  // The inactivity deadline slides forward on each heartbeat, so once it passes the fixed date the
  // date becomes the binding trigger - mirrors the on-chain `inactivity_due || date_due` condition.
  const inactivityDueTs = capsule.lastActivity + capsule.inactivityPeriod
  const effectiveDueTs = capsule.targetDate != null ? Math.min(inactivityDueTs, capsule.targetDate) : inactivityDueTs
  const status = capsule.executedAt
    ? 'Executed'
    : !capsule.isActive
      ? 'Waiting'
      : effectiveDueTs < Math.floor(Date.now() / 1000)
        ? 'Expired'
        : 'Active'
  const isDelegated = capsule.accountOwner?.equals?.(new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)) ?? false
  const lastUpdatedMs = capsule.lastActivity ? capsule.lastActivity * 1000 : null
  const targetDateMs = capsule.targetDate != null ? capsule.targetDate * 1000 : null
  // While delegated, the private beneficiary list is readable only by the owner via a TEE auth token.
  const privateStateHidden = isDelegated && isOwner && capsule.beneficiaries.length === 0

  // Mint (or reuse) a TEE auth token and re-read the live private state from the TEE node.
  const handleReveal = async () => {
    if (!capsule || !wallet.publicKey) return
    setRevealing(true)
    setRevealError(null)
    try {
      const token = await getOrMintTeeToken(wallet as any)
      const refreshed = await getCapsuleByAddress(new PublicKey(capsule.capsuleAddress), token)
      if (refreshed) setCapsule(refreshed)
      else setRevealError('Could not read private state from the TEE.')
    } catch (e: any) {
      setRevealError(e?.message || 'Failed to authorize the TEE read.')
    } finally {
      setRevealing(false)
    }
  }

  return (
    <div className="min-h-screen bg-hero text-Heres-white">
      {/* Confirm dialogs for destructive actions */}
      <ConfirmDialog
        open={confirmRecover}
        onClose={() => setConfirmRecover(false)}
        onConfirm={() => { setConfirmRecover(false); handleRecoverVault() }}
        title="Withdraw Funds"
        description="Withdraw all funds from this capsule back to your wallet? The capsule stays active and armed - you can re-fund it with another deposit later."
        confirmLabel="Withdraw"
        variant="danger"
        typedConfirm="withdraw"
        loading={actionLoading === 'recover'}
      />
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => { setConfirmCancel(false); handleCancelCapsule() }}
        title="Cancel Capsule"
        description="Cancel this capsule? This refunds all funds and account rent to your wallet and PERMANENTLY closes the capsule. This cannot be undone."
        confirmLabel="Cancel Capsule"
        variant="danger"
        typedConfirm="cancel"
        loading={actionLoading === 'cancel'}
      />
      <ConfirmDialog
        open={confirmUndelegate}
        onClose={() => setConfirmUndelegate(false)}
        onConfirm={() => { setConfirmUndelegate(false); handleUndelegate() }}
        title="Undelegate from Ephemeral Rollup"
        description={
          <span>
            Undelegating commits the private beneficiary list from the TEE to the <strong>public base layer</strong>. After this point the beneficiary addresses will be visible on-chain and <strong>will no longer be private</strong>. Only proceed if you are ready to settle the capsule publicly.
          </span>
        }
        confirmLabel="Undelegate"
        variant="danger"
        typedConfirm="undelegate"
        loading={actionLoading === 'undelegate'}
      />

      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <ServicePageHeader
            className="mb-6"
            eyebrow={<SectionEyebrow>Capsule Detail</SectionEyebrow>}
            title="Capsule"
            description={`${isNft ? 'NFT capsule' : `Token (${assetConfig.symbol}) capsule`} · Inactivity period: ${formatDuration(capsule.inactivityPeriod)}${targetDateMs != null ? ` · Fires by ${new Date(targetDateMs).toLocaleDateString()}` : ''}`}
            statusLine={`Updated ${timeAgo(lastUpdatedMs)}`}
            badges={
              <>
                <span className="font-mono text-sm text-Heres-muted" title={capsule.capsuleAddress}>
                  {maskAddress(capsule.capsuleAddress)}
                </span>
                <span className="rounded-lg border border-Heres-border bg-Heres-surface/80 px-2.5 py-1 text-xs font-medium text-Heres-muted">
                  v1.0
                </span>
                <StatusChip status={status} />
                {isDelegated && <StatusChip status="delegated" />}
              </>
            }
          />

          <ServiceMetaGrid className="mb-6">
            <ServiceMetaCard label="Network">
              <p className="text-sm font-medium text-Heres-white">
                {getNetworkDisplayLabel()}
              </p>
            </ServiceMetaCard>
            <ServiceMetaCard label="Capsule ID">
              <AddressPill address={capsule.capsuleAddress} explorer="address" />
            </ServiceMetaCard>
            <ServiceMetaCard label="Owner">
              <AddressPill address={capsule.owner.toBase58()} explorer="address" />
            </ServiceMetaCard>
            <ServiceMetaCard label="Program ID">
              <AddressPill address={getProgramId().toBase58()} explorer="address" />
            </ServiceMetaCard>
            <ServiceMetaCard label="Beneficiaries">
              <p className="text-sm font-mono text-Heres-white">
                {capsule.beneficiaries.length > 0 ? `${capsule.beneficiaries.length} on-chain` : 'Not set'}
              </p>
            </ServiceMetaCard>
            <ServiceMetaCard label="Trigger">
              <p className="text-sm font-medium text-Heres-white">
                {formatDuration(capsule.inactivityPeriod)} inactivity
              </p>
              {targetDateMs != null ? (
                <p className="mt-0.5 text-xs text-Heres-accent">
                  or fixed date {new Date(targetDateMs).toLocaleDateString()} (whichever first)
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-Heres-muted">No fixed date</p>
              )}
            </ServiceMetaCard>
          </ServiceMetaGrid>

          {/* Privacy & Delegation (PER / TEE) */}
          <ServiceSection
            title={
              <span className="flex flex-wrap items-center gap-3">
                <span>Privacy &amp; Delegation (PER / TEE)</span>
                <span className="rounded-lg border border-Heres-accent/50 bg-Heres-accent/10 px-2.5 py-1 text-xs font-medium text-Heres-accent">
                  PER (TEE) enabled
                </span>
              </span>
            }
            description="This capsule uses the Private Ephemeral Rollup (PER) with TEE. Delegation and crank scheduling happen automatically at creation. Conditions are monitored confidentially inside the TEE."
            className="mb-6"
            tone="accent"
          >
            <div className="rounded-xl border border-Heres-border/50 bg-Heres-surface/30 p-4 mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-Heres-accent mb-1">Where is private monitoring?</p>
              <p className="text-sm text-Heres-muted">
                Private monitoring runs inside the TEE automatically after capsule creation. Conditions (inactivity, intent) are checked confidentially and are not visible on the public chain. The beneficiary list lives only inside the TEE while delegated; the owner can read it with a one-time auth signature.
              </p>
              {privateStateHidden && (
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleReveal}
                    disabled={revealing}
                    loading={revealing}
                  >
                    {revealing ? 'Authorizing TEE...' : 'Reveal private details'}
                  </Button>
                  {revealError && <p className="mt-2 text-xs text-red-400">{revealError}</p>}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-Heres-border bg-Heres-card/80 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-Heres-muted mb-1">Privacy mode</p>
                <p className="text-sm font-medium text-Heres-accent">PER (TEE)</p>
              </div>
              <div className="rounded-xl border border-Heres-border bg-Heres-card/80 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-Heres-muted mb-1">Default validator</p>
                <p className="text-sm font-medium text-Heres-white">TEE</p>
              </div>
              <div className="rounded-xl border border-Heres-border bg-Heres-card/80 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-Heres-muted mb-1">Validator address</p>
                <AddressPill address={MAGICBLOCK_ER.VALIDATOR_TEE} />
              </div>
              <div className="rounded-xl border border-Heres-border bg-Heres-card/80 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-Heres-muted mb-1">TEE RPC</p>
                <div className="flex items-center gap-1 min-w-0">
                  <a
                    href={PER_TEE.DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-mono text-Heres-accent truncate hover:underline"
                    title="Open TEE / PER docs"
                  >
                    {PER_TEE.RPC_URL.replace(/^https:\/\//, '')}
                  </a>
                  <CopyButton value={PER_TEE.RPC_URL} />
                </div>
                <p className="text-[10px] text-Heres-muted mt-1">RPC is API-only; link opens TEE docs</p>
              </div>
            </div>
          </ServiceSection>

          <ServiceSection title="Beneficiaries & Intent" className="mb-6">
            <p className="text-sm text-Heres-muted mb-4">
              {intentParsed?.intent
                || 'The human intent statement is encrypted off-chain and delivered to the beneficiary via CRE. Only the on-chain beneficiary split is shown here.'}
            </p>
            {capsule.beneficiaries.length > 0 ? (
              <div className="space-y-2">
                {capsule.beneficiaries.map((b, i) => (
                  <div
                    key={`${b.pubkey.toBase58()}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-Heres-border bg-Heres-card/80 px-3 py-2"
                  >
                    <AddressPill address={b.pubkey.toBase58()} explorer="address" />
                    <span className="text-sm font-semibold text-Heres-accent tabular-nums shrink-0">
                      {(b.shareBps / 100).toFixed(b.shareBps % 100 === 0 ? 0 : 2)}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-Heres-muted">No beneficiaries set on-chain yet.</p>
            )}
          </ServiceSection>

          {isCreEnabled && (
            <ServiceSection
              title="Intent Statement Delivery"
              description="Off-chain encrypted Intent Statement package delivery powered by CRE orchestration."
              className="mb-6"
              tone="accent"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-Heres-border bg-Heres-card/80 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-Heres-muted mb-1">Channel</p>
                  <p className="text-sm text-Heres-white">
                    {(creConfig?.deliveryChannel || 'email').toUpperCase()}
                  </p>
                </div>
                <div className="rounded-xl border border-Heres-border bg-Heres-card/80 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-Heres-muted mb-1">Recipient Commitment</p>
                  <p className="text-sm text-Heres-white font-mono">
                    {creConfig?.recipientEmailHash
                      ? `${creConfig.recipientEmailHash.slice(0, 16)}...`
                      : creConfig?.recipientEmail
                        ? 'legacy-email-onchain'
                      : '-'}
                  </p>
                </div>
                <div className="rounded-xl border border-Heres-border bg-Heres-card/80 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-Heres-muted mb-1">Delivery Status</p>
                  {creDeliveryLoading ? (
                    <p className="text-sm text-Heres-muted">Loading...</p>
                  ) : !wallet.connected ? (
                    <p className="text-sm text-Heres-muted">Connect wallet</p>
                  ) : !isOwner ? (
                    <p className="text-sm text-Heres-muted">Owner auth required</p>
                  ) : (
                    <p className="text-sm text-Heres-accent">{creDeliveryStatus?.status || 'pending'}</p>
                  )}
                </div>
              </div>
              {creDeliveryStatus?.lastError && (
                <p className="text-xs text-amber-400 mt-3">{creDeliveryStatus.lastError}</p>
              )}
              {creDeliveryError && (
                <p className="text-xs text-red-400 mt-3">{creDeliveryError}</p>
              )}
            </ServiceSection>
          )}

          {/* Actions - status-based flow */}
          {isOwner && (() => {
            const isExecuted = status === 'Executed' || (!capsule.isActive && capsule.executedAt)
            const isExpired = status === 'Expired'
            const isActive = status === 'Active'
            const isCreDelivered = creDeliveryStatus?.status === 'delivered'
            const isDistributed = Boolean(isExecuted && distributionComplete)
            const canExecute = isExpired && !isExecuted
            const canUndelegate = Boolean(isDelegated)
            const canDistribute = Boolean(isExecuted && !isDelegated && !isDistributed)
            const canDispatchCre = Boolean(isExecuted && isDistributed && isCreEnabled && !isCreDelivered)
            const canRefreshAutomation = Boolean((isExpired || isActive) && !isExecuted)
            // Owner early-exit (pre-fire only). Recover works even while delegated; full cancel needs
            // the accounts undelegated to base first, so it is gated on !isDelegated.
            const preFire = Boolean(capsule.isActive)
            const canRecover = preFire
            const canCancel = preFire && !isDelegated

            const steps = [
              { num: 1, label: 'Execute Intent', desc: 'Deactivate capsule when inactivity condition met' },
              { num: 2, label: 'Distribute Assets', desc: `Transfer ${assetConfig.symbol}/tokens to beneficiaries` },
              ...(isCreEnabled ? [{ num: 3, label: 'Deliver Intent Statement', desc: 'Dispatch encrypted intent via CRE' }] : []),
            ]
            const allDone = Boolean(isExecuted && isDistributed && (!isCreEnabled || isCreDelivered))

            // Determine current step (1-based)
            const currentStep = allDone ? steps.length + 1 : canDispatchCre ? 3 : isExecuted ? 2 : canExecute ? 1 : 0

            return (
              <ServiceSection title="Actions" className="mb-6" tone="warning">
                {/* Status guidance */}
                <div className="rounded-lg border border-Heres-border/50 bg-Heres-surface/30 p-3 mb-5">
                  {isActive && (
                    <p className="text-sm text-Heres-muted">
                      Capsule is <span className="text-Heres-accent font-medium">Active</span>. {targetDateMs != null ? 'Neither the inactivity period nor the fixed fire date has been reached yet.' : 'The inactivity period has not elapsed yet.'} Execute and Distribute unlock once it expires; you can <strong>Withdraw Funds</strong> any time, or <strong>Cancel Capsule</strong> after undelegating from the ER.
                    </p>
                  )}
                  {canExecute && (
                    <p className="text-sm text-amber-400">
                      {targetDateMs != null ? 'A trigger condition has been met' : 'Inactivity period has elapsed'}. You can now <strong>Execute Intent</strong> to deactivate the capsule, then distribute assets.
                    </p>
                  )}
                  {isExpired && !isExecuted && (
                    <p className="mt-2 text-sm text-blue-400">
                      If external automation missed this capsule, use <strong>Refresh Automation</strong> to re-register it for the crank without creating a new capsule.
                    </p>
                  )}
                  {isExecuted && isDelegated && (
                    <p className="text-sm text-blue-400">
                      Capsule executed on ER. <strong>Undelegate from ER</strong> first, then distribute assets on the base layer.
                    </p>
                  )}
                  {isDistributed && isCreEnabled && !isCreDelivered && (
                    <p className="text-sm text-Heres-accent">
                      Assets already reached the beneficiary. Proceed to <strong>Deliver Intent Statement</strong> via CRE.
                    </p>
                  )}
                  {isExecuted && !isDistributed && !allDone && !isDelegated && (
                    <p className="text-sm text-Heres-accent">
                      Capsule executed. Proceed to <strong>Distribute Assets</strong>{isCreEnabled ? ' and then dispatch Intent Statement delivery via CRE.' : '.'}
                    </p>
                  )}
                  {allDone && (
                    <p className="text-sm text-green-400">
                      {isCreEnabled
                        ? 'All steps complete. Assets distributed and intent statement delivered.'
                        : 'All steps complete. Assets distributed to the beneficiary.'}
                    </p>
                  )}
                  {status === 'Waiting' && (
                    <p className="text-sm text-Heres-purple">
                      Capsule is in <span className="font-medium">Waiting</span> state. No actions available.
                    </p>
                  )}
                </div>

                {/* Step indicator */}
                <div className="flex items-center gap-2 mb-5 overflow-x-auto">
                  {steps.map((step, i) => {
                    const done = step.num < currentStep || (step.num === 3 && allDone)
                    const active = step.num === currentStep || (step.num === 2 && currentStep === 2) || (step.num === 3 && currentStep >= 2 && !allDone)
                    return (
                      <div key={step.num} className="flex items-center gap-2">
                        {i > 0 && <div className={`w-8 h-px ${done ? 'bg-green-500' : 'bg-Heres-border'}`} />}
                        <div className="flex items-center gap-2 shrink-0">
                          <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                            done ? 'bg-green-500/20 text-green-400 border border-green-500/40' :
                            active ? 'bg-Heres-accent/20 text-Heres-accent border border-Heres-accent/40' :
                            'bg-Heres-surface/50 text-Heres-muted border border-Heres-border'
                          }`}>
                            {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step.num}
                          </div>
                          <div>
                            <p className={`text-xs font-medium ${done ? 'text-green-400' : active ? 'text-Heres-white' : 'text-Heres-muted'}`}>
                              {step.label}
                            </p>
                            <p className="text-[10px] text-Heres-muted hidden sm:block">{step.desc}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleExecuteIntent}
                    disabled={!canExecute || !!actionLoading}
                    loading={actionLoading === 'execute'}
                    title={!canExecute ? (isActive ? (targetDateMs != null ? 'No trigger condition met yet' : 'Inactivity period not elapsed') : isExecuted ? 'Already executed' : 'Not available') : 'Execute intent on-chain'}
                  >
                    {isExecuted ? 'Executed' : 'Execute Intent'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDistributeAssets}
                    disabled={!canDistribute || !!actionLoading}
                    loading={actionLoading === 'distribute'}
                    title={
                      !canDistribute
                        ? isDelegated
                          ? 'Undelegate from ER first'
                          : 'Execute intent first'
                        : `Distribute ${assetConfig.symbol}/tokens to beneficiaries`
                    }
                  >
                    Distribute Assets
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleRefreshAutomation}
                    disabled={!canRefreshAutomation || !!actionLoading}
                    loading={actionLoading === 'automation'}
                    title={!canRefreshAutomation ? 'Only pending capsules can be re-registered for automation' : 'Re-register this capsule for external crank discovery'}
                  >
                    Refresh Automation
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmUndelegate(true)}
                    disabled={!canUndelegate || !!actionLoading}
                    loading={actionLoading === 'undelegate'}
                    title={!canUndelegate ? 'Capsule is already on base layer' : 'Commit ER state and undelegate back to Solana base layer'}
                  >
                    Undelegate from ER
                  </Button>
                  {isCreEnabled && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleCreDispatch}
                      disabled={!canDispatchCre || creDispatchLoading || !!actionLoading}
                      loading={creDispatchLoading}
                      title={!canDispatchCre ? 'Execute intent first' : 'Dispatch encrypted intent statement via CRE'}
                    >
                      Deliver Intent Statement
                    </Button>
                  )}
                  {/* Owner early-exit (pre-fire): withdraw funds, or fully cancel + close. */}
                  {preFire && (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setConfirmRecover(true)}
                        disabled={!canRecover || !!actionLoading}
                        loading={actionLoading === 'recover'}
                        title="Withdraw all funds from the capsule back to your wallet. The capsule stays active and armed."
                      >
                        Withdraw Funds
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setConfirmCancel(true)}
                        disabled={!canCancel || !!actionLoading}
                        loading={actionLoading === 'cancel'}
                        title={!canCancel ? 'Undelegate from ER first (this settles the capsule to base), then cancel' : 'Refund all funds + account rent and permanently close the capsule'}
                      >
                        Cancel Capsule
                      </Button>
                    </>
                  )}
                </div>

                {/* Result messages */}
                {actionResult && (
                  <div className={`mt-4 rounded-lg border p-3 text-sm break-all ${
                    actionResult.type === 'success'
                      ? 'border-green-500/30 bg-green-500/10 text-green-400'
                      : 'border-red-500/30 bg-red-500/10 text-red-400'
                  }`}>
                    {actionResult.message}
                  </div>
                )}
                {creDispatchResult && (
                  <div className={`mt-3 rounded-lg border p-3 text-sm break-all ${
                    creDispatchResult.type === 'success'
                      ? 'border-blue-500/30 bg-blue-500/10 text-blue-400'
                      : 'border-red-500/30 bg-red-500/10 text-red-400'
                  }`}>
                    {creDispatchResult.message}
                  </div>
                )}
              </ServiceSection>
            )
          })()}

          <ServiceSection
            title={isToken ? `${assetConfig.symbol} Price (USD)` : `NFT Value (${assetConfig.symbol} / USD proxy)`}
            className="mb-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div>
                <p className="text-sm text-Heres-muted mt-1">
                  {isToken
                    ? `Real-time ${assetConfig.symbol} price (CoinGecko).`
                    : `Representative value trend (${assetConfig.symbol}/USD) for reference.`}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {isToken && (
                  <div className="rounded-lg border border-Heres-border/80 bg-Heres-card/80 px-2.5 py-1.5 flex items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-Heres-muted">1 {assetConfig.symbol}</span>
                    <span className="text-sm font-semibold tabular-nums text-Heres-accent">${displayedSolPrice.toFixed(2)}</span>
                    <span className="text-[10px] text-Heres-muted">USD</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  {CHART_RANGES.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setChartRange(r.key)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${chartRange === r.key
                        ? 'border-Heres-accent bg-Heres-accent/20 text-Heres-accent'
                        : 'border-Heres-border bg-Heres-card/80 text-Heres-muted hover:border-Heres-accent/40 hover:text-Heres-accent'
                        }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {chartLoading ? (
              <div className="relative h-64 flex items-center justify-center text-Heres-muted">
                <RefreshCw className="h-8 w-8 animate-spin" />
              </div>
            ) : chartData.length > 0 ? (
              <div className="relative h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <defs>
                      <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--Heres-accent)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--Heres-accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--Heres-card)', border: '1px solid var(--Heres-border)' }}
                      labelStyle={{ color: 'var(--Heres-white)' }}
                      formatter={(value) => [value != null && !Array.isArray(value) ? '$' + Number(value).toFixed(2) : '$0.00', 'USD']}
                    />
                    <Area
                      type="monotone"
                      dataKey="usd"
                      stroke="var(--Heres-accent)"
                      strokeWidth={2}
                      fill="url(#chartGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-Heres-muted text-sm">
                Chart data unavailable
              </div>
            )}
          </ServiceSection>

        </div>
      </main>
    </div>
  )
}

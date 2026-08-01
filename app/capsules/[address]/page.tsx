'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useHeresWallet } from '@/hooks/useHeresWallet'
import { Check, Eye, RefreshCw, HeartPulse, Plus, Pencil } from 'lucide-react'
import {
  executeIntent,
  distributeAssets,
  finalizeCapsule,
  undelegateCapsule,
  cancelCapsule,
  recoverVault,
  updateActivity,
  registerCapsuleOwnerForAutomation,
  getCapsuleAccountLocations,
} from '@/lib/solana'
import { getOrMintTeeToken } from '@/lib/tee'
import { getProgramId, getSolanaConnection } from '@/config/solana'
import { MAGICBLOCK_ER, PER_TEE, getNetworkDisplayLabel } from '@/constants'
import { formatDuration } from '@/utils/intent'
import { buildIntentSignedMessage } from '@/utils/intentAuth'
import { bytesToBase64 } from '@/utils/intentClient'
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
import { useCapsuleDetail } from '@/hooks/queries/useCapsuleDetail'
import { useAssetPrice } from '@/hooks/queries/useAssetPrice'
import { WithdrawFundsDialog } from '@/components/capsule/WithdrawFundsDialog'
import { AddFundsDialog } from '@/components/capsule/AddFundsDialog'
import { EditBeneficiariesDialog } from '@/components/capsule/EditBeneficiariesDialog'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { isAdminWallet } from '@/lib/admin'
import { PrivyLoginButton } from '@/components/PrivyLoginButton'
import { getCapsuleVaultPDA } from '@/lib/program'
import { getVaultTokenAccounts, TOKEN_2022_PROGRAM_ID } from '@/lib/spl'
import { formatBaseUnits, planMultiMintCancellation } from '@/lib/fungible-assets'
import {
  areCapsuleAccountsOnBase,
  capsuleSettlementGuidance,
  hasDelegatedCapsuleAccounts,
  isCapsulePreFire,
} from '@/lib/capsule-lifecycle'

const CHART_RANGES = [
  { key: '6h', label: '6h', days: 1, hoursFilter: 6 },
  { key: '12h', label: '12h', days: 1, hoursFilter: 12 },
  { key: '1d', label: '1D', days: 1, hoursFilter: null },
  { key: '1mo', label: '1M', days: 30, hoursFilter: null },
  { key: '1y', label: '1Y', days: 365, hoursFilter: null },
] as const

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
  const wallet = useHeresWallet()
  // Detail pages are scoped to the capsule owner; admins may view any capsule.
  // This is a UI scope only -- the underlying account is public on-chain, while
  // the private beneficiary set stays TEE-gated to the owner regardless.
  const isAdmin = isAdminWallet(wallet.publicKey ?? null)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const address = typeof params?.address === 'string' ? params.address : null

  // UI-only state
  const [chartRange, setChartRange] = useState<(typeof CHART_RANGES)[number]['key']>('1d')
  const [displayedSolPrice, setDisplayedSolPrice] = useState<number>(0)
  const displayedPriceRef = useRef(0)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error' | 'progress'; message: string } | null>(null)
  const [intentDispatchLoading, setIntentDispatchLoading] = useState(false)
  const [intentDispatchResult, setIntentDispatchResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)

  // ConfirmDialog open state for destructive actions
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmUndelegate, setConfirmUndelegate] = useState(false)
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  // Asset-management dialogs
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showAddFunds, setShowAddFunds] = useState(false)
  const [showEditBeneficiaries, setShowEditBeneficiaries] = useState(false)

  const {
    capsule,
    capsuleLoading,
    capsuleError,
    meta,
    isOwner,
    isIntentEnabled,
    accountLocations,
    accountLocationsLoading,
    accountLocationsError,
    vaultAssets,
    vaultAssetsLoading,
    vaultAssetsError,
    distributionComplete,
    distributionLoading,
    distributionError,
    intentDeliveryStatus,
    intentDeliveryLoading,
    intentDeliveryError,
    invalidateCapsule,
    invalidateDistribution,
    invalidateVaultAssets,
  } = useCapsuleDetail({ address })

  const intentParsed = meta as IntentParsed | null
  const isNft = meta?.type === 'nft' || (capsule?.nftAssignments?.length ?? 0) > 0
  const isToken = !isNft
  const assetConfig = inferAssetConfig(meta ?? undefined)
  const intentConfig = intentParsed?.cre ?? intentParsed?.premium

  const rangeConfig = useMemo(() => CHART_RANGES.find((r) => r.key === chartRange) ?? CHART_RANGES[2], [chartRange])

  const { currentSolPrice, chartData, chartLoading } = useAssetPrice({
    coingeckoId: assetConfig.coingeckoId,
    rangeKey: rangeConfig.key,
    days: rangeConfig.days,
    hoursFilter: rangeConfig.hoursFilter,
    isToken,
    isNft,
  })

  // Keep ref in sync for animation start value
  displayedPriceRef.current = displayedSolPrice

  // Effect 8: price ticker animation (pure UI - kept in page as specified)
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

  // ---------------------------------------------------------------------------
  // Mutation handlers (bodies unchanged; invalidate instead of setCapsule)
  // ---------------------------------------------------------------------------

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
      await invalidateCapsule()
    } catch (err: any) {
      console.error('[Execute Intent] Error:', err)
      const msg = normalizeTxError(err)
      setActionResult({ type: 'error', message: msg })
      toast({ message: msg, variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleDistributeAssets = async () => {
    if (!wallet.connected || !wallet.publicKey || !capsule) return
    setActionLoading('distribute')
    setActionResult(null)
    let completedLegs = 0
    try {
      const liveLocations = await getCapsuleAccountLocations(capsule.owner)
      if (!areCapsuleAccountsOnBase(liveLocations)) {
        throw new Error(capsuleSettlementGuidance(liveLocations))
      }
      if (!capsule.beneficiaries.length) throw new Error('Capsule has no beneficiaries set')
      // Beneficiaries + shares are read from the on-chain capsule; distribute splits every vault asset
      // by share_bps (SPL legs first, then the SOL leg).
      const tx = await distributeAssets(
        wallet as any,
        capsule.owner,
        capsule.beneficiaries,
        capsule.nftAssignments ?? [],
        (progress) => {
          completedLegs = progress.completed
          setActionResult({
            type: 'progress',
            message: `Distributed ${progress.completed} asset leg${progress.completed === 1 ? '' : 's'}...`,
          })
        }
      )
      setActionResult({ type: 'success', message: `Distribute Assets TX: ${tx}` })
      toast({ message: 'Assets distributed to beneficiaries.', variant: 'success' })
    } catch (err: any) {
      console.error('[Distribute Assets] Error:', err)
      const msg = normalizeTxError(err)
      const partialNote = completedLegs > 0
        ? ` ${completedLegs} asset leg${completedLegs === 1 ? ' was' : 's were'} already distributed. Refresh and retry to process only the remaining vault assets.`
        : ''
      setActionResult({ type: 'error', message: `${msg}${partialNote}` })
      toast({ message: `${msg}${partialNote}`, variant: 'error' })
    } finally {
      await Promise.allSettled([
        invalidateDistribution(),
        invalidateVaultAssets(),
        invalidateCapsule(),
      ])
      setActionLoading(null)
    }
  }

  const handleFinalizeCapsule = async () => {
    if (!wallet.connected || !wallet.publicKey || !capsule) return
    setActionLoading('finalize')
    setActionResult(null)
    try {
      const tx = await finalizeCapsule(wallet as any, capsule.owner)
      toast({ message: 'Capsule finalized and on-chain accounts closed.', variant: 'success' })
      setActionResult({ type: 'success', message: `Finalize Capsule TX: ${tx}` })
      await queryClient.invalidateQueries({ queryKey: queryKeys.capsule.all })
      router.push('/capsules')
    } catch (err: any) {
      console.error('[Finalize Capsule] Error:', err)
      const msg = normalizeTxError(err)
      setActionResult({ type: 'error', message: err.message || 'Finalization failed' })
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
      const liveLocations = await getCapsuleAccountLocations(capsule.owner)
      if (!hasDelegatedCapsuleAccounts(liveLocations)) {
        throw new Error('The capsule and beneficiary data are already settled on Solana. Refresh My Capsule to continue.')
      }
      // The two-step undelegate reveals the private BeneficiarySet from the TEE, which needs the
      // owner's auth token; reuse the session token (minted once) so there's no extra signMessage.
      const token = liveLocations.beneficiarySet === 'delegated'
        ? await getOrMintTeeToken(wallet as any)
        : undefined
      const tx = await undelegateCapsule(wallet as any, capsule.owner, token)
      // Token is now cached; invalidating the capsule query re-reads with the cached token.
      await invalidateCapsule()
      setActionResult({ type: 'success', message: `Undelegate TX: ${tx}` })
      toast({ message: 'Capsule undelegated from Ephemeral Rollup.', variant: 'success' })
    } catch (err: any) {
      console.error('[Undelegate] Error:', err)
      const msg = normalizeTxError(err)
      setActionResult({ type: 'error', message: msg })
      toast({ message: msg, variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  // Refresh on-chain state after a deposit/withdraw (vault balances + capsule). Used as the dialogs'
  // onWithdrawn / onDeposited callback so the balance-gated buttons re-evaluate immediately.
  const refreshVault = async () => {
    await Promise.all([invalidateVaultAssets(), invalidateCapsule()])
  }

  // Proof-of-life: bump last_activity so the inactivity deadline slides forward while active.
  const handleUpdateActivity = async () => {
    if (!wallet.connected || !wallet.publicKey || !capsule) return
    setActionLoading('checkin')
    setActionResult(null)
    try {
      const tx = await updateActivity(wallet as any, capsule.owner)
      await invalidateCapsule()
      setActionResult({
        type: 'success',
        message: `Liveness updated. TX: ${tx}`,
      })
      toast({ message: 'Liveness updated - timer reset.', variant: 'success' })
    } catch (err: any) {
      console.error('[Update Activity] Error:', err)
      const msg = normalizeTxError(err)
      setActionResult({ type: 'error', message: msg })
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
    let recoveredMintCount = 0
    try {
      const liveLocations = await getCapsuleAccountLocations(capsule.owner)
      if (!areCapsuleAccountsOnBase(liveLocations)) {
        throw new Error(capsuleSettlementGuidance(liveLocations))
      }
      // Read every vault ATA at action time, including zero-balance accounts. recover_vault closes
      // each ATA and refunds its rent; cancel_capsule closes the final ATA plus the capsule PDAs.
      const [vaultPDA] = getCapsuleVaultPDA(capsule.owner)
      const tokenAccounts = await getVaultTokenAccounts(getSolanaConnection(), vaultPDA)
      const { recoverFirst, cancelWith } = planMultiMintCancellation(
        tokenAccounts.map((account) => account.mint)
      )
      for (const [index, mint] of recoverFirst.entries()) {
        setActionResult({
          type: 'progress',
          message: `Recovering vault token ${index + 1} of ${recoverFirst.length} before cancellation...`,
        })
        await recoverVault(wallet as any, capsule.owner, mint)
        recoveredMintCount += 1
      }
      setActionResult({ type: 'progress', message: 'Closing the capsule and reclaiming remaining assets...' })
      const tx = await cancelCapsule(wallet as any, cancelWith ?? undefined)
      setActionResult({ type: 'success', message: `Capsule cancelled and assets reclaimed. TX: ${tx}` })
      toast({ message: 'Capsule cancelled and assets reclaimed.', variant: 'success' })
      // The accounts are now closed; send the owner back to the list.
      setTimeout(() => router.push('/capsules'), 2500)
    } catch (err: any) {
      console.error('[Cancel Capsule] Error:', err)
      const msg = normalizeTxError(err)
      const recoveryNote = recoveredMintCount > 0
        ? ` ${recoveredMintCount} token account${recoveredMintCount === 1 ? ' was' : 's were'} already recovered. Refresh the vault and retry cancellation.`
        : ''
      setActionResult({ type: 'error', message: `${msg}${recoveryNote}` })
      toast({ message: msg, variant: 'error' })
    } finally {
      await Promise.allSettled([invalidateVaultAssets(), invalidateCapsule()])
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
        message: msg,
      })
      toast({ message: msg, variant: 'error' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleIntentDispatch = async () => {
    if (!wallet.connected || !wallet.publicKey || !capsule || !wallet.signMessage) return
    setIntentDispatchLoading(true)
    setIntentDispatchResult(null)
    try {
      const owner = wallet.publicKey.toBase58()
      const timestamp = Date.now()
      const message = buildIntentSignedMessage({
        action: 'dispatch',
        owner,
        capsuleAddress: capsule.capsuleAddress,
        timestamp,
      })
      const signature = bytesToBase64(await wallet.signMessage(new TextEncoder().encode(message)))
      const res = await fetch('/api/intent-delivery/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-intent-signature': signature },
        body: JSON.stringify({ capsule: capsule.capsuleAddress, owner, timestamp }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'CRE dispatch failed')
      setIntentDispatchResult({ type: 'success', message: `Intent Statement delivery ${data.status || 'completed'}` })
      toast({ message: 'Intent Statement delivery completed.', variant: 'success' })
      if (address) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.capsule.intentDelivery(address) })
      }
    } catch (err: any) {
      const msg = normalizeTxError(err)
      setIntentDispatchResult({ type: 'error', message: msg })
      toast({ message: msg, variant: 'error' })
    } finally {
      setIntentDispatchLoading(false)
    }
  }

  // Mint (or reuse) a TEE auth token and re-read the live private state from the TEE node.
  const handleReveal = async () => {
    if (!capsule || !wallet.publicKey) return
    setRevealing(true)
    setRevealError(null)
    try {
      // Mint the token (caches it in module-level map); then invalidate the capsule query
      // so the queryFn re-runs and reads the now-cached token at call time.
      await getOrMintTeeToken(wallet as any)
      if (address) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.capsule.byAddress(address) })
      }
    } catch (e: any) {
      setRevealError(normalizeTxError(e))
    } finally {
      setRevealing(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (capsuleLoading) {
    return (
      <div className="min-h-screen bg-hero text-Heres-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-8 w-8 animate-spin text-Heres-accent" />
          <p className="text-Heres-muted">Loading capsule...</p>
        </div>
      </div>
    )
  }

  if (capsuleError || !capsule) {
    return (
      <div className="min-h-screen bg-hero text-Heres-white pt-24 pb-16 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-red-400 mb-6">{capsuleError || 'Capsule not found'}</p>
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

  // Scope the detail view to the owner (or an admin). A non-owner sees a prompt to
  // connect or to open their own capsule instead of another wallet's.
  if (!isOwner && !isAdmin) {
    return (
      <div className="min-h-screen bg-hero text-Heres-white pt-24 pb-16 px-4">
        <div className="max-w-md mx-auto text-center rounded-2xl border border-Heres-border bg-Heres-card/60 p-8 sm:p-12">
          <h2 className="mb-3 font-serif text-2xl font-semibold text-vellum">
            {wallet.connected ? 'Not your capsule' : 'Sign in to continue'}
          </h2>
          <p className="mb-6 text-Heres-muted">
            {wallet.connected
              ? 'This capsule belongs to another wallet. You can view and manage your own capsule instead.'
              : 'Capsule details are private to their owner. Sign in to view your own capsule.'}
          </p>
          <div className="flex flex-col items-center gap-3">
            {!wallet.connected && (
              <div className="wallet-menu-container flex justify-center">
                <PrivyLoginButton />
              </div>
            )}
            <Link
              href="/capsules"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-Heres-border bg-Heres-card/80 px-4 py-2 text-sm font-medium text-Heres-white transition-colors hover:border-Heres-accent/40"
            >
              Go to My Capsule
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Effective due time = the earlier of the inactivity deadline and the optional fixed target date.
  // The inactivity deadline slides forward on each heartbeat, so once it passes the fixed date the
  // date becomes the binding trigger - mirrors the on-chain `inactivity_due || date_due` condition.
  const inactivityDueTs = capsule.lastActivity + capsule.inactivityPeriod
  const effectiveDueTs = capsule.targetDate != null ? Math.min(inactivityDueTs, capsule.targetDate) : inactivityDueTs
  const nowSec = Math.floor(Date.now() / 1000)
  const status = capsule.executedAt
    ? 'Executed'
    : !capsule.isActive
      ? 'Draft'
      : effectiveDueTs < nowSec
        ? 'Expired'
        : 'Active'
  const isDelegated = hasDelegatedCapsuleAccounts(accountLocations)
  const accountsOnBase = areCapsuleAccountsOnBase(accountLocations)
  const beneficiarySetDelegated = accountLocations?.beneficiarySet === 'delegated'
  const partiallyUndelegated = Boolean(
    accountLocations &&
      isDelegated &&
      (accountLocations.switch === 'base' || accountLocations.beneficiarySet === 'base')
  )
  const lastUpdatedMs = capsule.lastActivity ? capsule.lastActivity * 1000 : null
  const targetDateMs = capsule.targetDate != null ? capsule.targetDate * 1000 : null
  // While delegated, the private beneficiary list is readable only by the owner via a TEE auth token.
  const privateStateHidden = beneficiarySetDelegated && isOwner && capsule.beneficiaries.length === 0
  const vaultAssetCount = vaultAssets.tokens.length + (vaultAssets.withdrawableSol > 0 ? 1 : 0)
  const isMultiAssetVault = isToken && vaultAssetCount > 1

  // Proof-of-life is available only before the capsule fires.
  const canCheckIn = Boolean(isOwner && capsule.isActive)
  // Legacy capsules remain editable. New lifecycles seal the TEE configuration before arming.
  const canEditBeneficiaries = Boolean(
    isToken
      && isOwner
      && !capsule.inheritanceSealed
      && !capsule.executedAt
      && capsule.beneficiaries.length > 0
  )

  return (
    <div className="min-h-screen bg-hero text-Heres-white">
      {/* Asset-management dialogs. key remounts each on open so internal form state starts fresh. */}
      <WithdrawFundsDialog
        key={showWithdraw ? 'withdraw-open' : 'withdraw-closed'}
        open={showWithdraw}
        onClose={() => setShowWithdraw(false)}
        owner={capsule.owner}
        wallet={wallet}
        assets={vaultAssets}
        assetSymbol={assetConfig.symbol}
        assetMint={intentParsed?.assetMint ?? null}
        onWithdrawn={refreshVault}
      />
      <AddFundsDialog
        key={showAddFunds ? 'addfunds-open' : 'addfunds-closed'}
        open={showAddFunds}
        onClose={() => setShowAddFunds(false)}
        owner={capsule.owner}
        wallet={wallet}
        onDeposited={refreshVault}
      />
      <EditBeneficiariesDialog
        key={showEditBeneficiaries ? 'editben-open' : 'editben-closed'}
        open={showEditBeneficiaries}
        onClose={() => setShowEditBeneficiaries(false)}
        owner={capsule.owner}
        wallet={wallet}
        current={capsule.beneficiaries}
        onUpdated={invalidateCapsule}
      />
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => { setConfirmCancel(false); handleCancelCapsule() }}
        title="Cancel Capsule"
        description={
          vaultAssets.tokens.length > 1
            ? `This refunds all funds and account rent, then permanently closes the capsule. Your wallet will request ${vaultAssets.tokens.length} approvals so each token account can be recovered safely. This cannot be undone.`
            : 'This refunds all funds and account rent to your wallet and permanently closes the capsule. This cannot be undone.'
        }
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
      <ConfirmDialog
        open={confirmFinalize}
        onClose={() => setConfirmFinalize(false)}
        onConfirm={() => { setConfirmFinalize(false); handleFinalizeCapsule() }}
        title="Finalize Capsule"
        description="Finalize this settled capsule? This permanently closes its capsule, beneficiary, and vault accounts. Their reclaimed rent is sent to the Heres protocol fee account. You can create a fresh capsule afterward using the same wallet."
        confirmLabel="Finalize Capsule"
        variant="danger"
        typedConfirm="finalize"
        loading={actionLoading === 'finalize'}
      />

      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <ServicePageHeader
            className="mb-6"
            eyebrow={<SectionEyebrow>Capsule Detail</SectionEyebrow>}
            title="Capsule"
            description={`${isNft ? 'NFT capsule' : isMultiAssetVault ? `${vaultAssetCount}-asset token capsule` : `Token (${assetConfig.symbol}) capsule`} · Inactivity period: ${formatDuration(capsule.inactivityPeriod)}${targetDateMs != null ? ` · Fires by ${new Date(targetDateMs).toLocaleDateString()}` : ''}`}
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
              {privateStateHidden ? (
                <button
                  type="button"
                  onClick={handleReveal}
                  disabled={revealing}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-Heres-accent transition-colors hover:text-Heres-white disabled:opacity-60"
                  title="Beneficiaries are private inside the TEE. Sign to reveal them."
                >
                  <Eye className="h-4 w-4 shrink-0" />
                  {revealing ? 'Revealing...' : 'Private - reveal'}
                </button>
              ) : (
                <p className="text-sm font-medium text-Heres-white">
                  {capsule.beneficiaries.length > 0
                    ? `${capsule.beneficiaries.length} beneficiar${capsule.beneficiaries.length === 1 ? 'y' : 'ies'}`
                    : 'Not set'}
                </p>
              )}
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

          <ServiceSection
            title="Vault Assets"
            description="Live base-layer balances held by this capsule. Every asset follows the same beneficiary percentage split."
            className="mb-6"
          >
            {vaultAssetsLoading ? (
              <div className="grid gap-3 sm:grid-cols-2" aria-label="Loading vault assets">
                <div className="h-20 animate-pulse rounded-xl border border-Heres-border bg-Heres-surface/40" />
                <div className="h-20 animate-pulse rounded-xl border border-Heres-border bg-Heres-surface/40" />
              </div>
            ) : vaultAssetsError ? (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                <p className="text-sm text-amber-200">{vaultAssetsError}</p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={refreshVault}>
                  Retry vault check
                </Button>
              </div>
            ) : vaultAssetCount === 0 ? (
              <div className="rounded-xl border border-dashed border-Heres-border bg-Heres-surface/20 p-5 text-sm text-Heres-muted">
                This vault has no funded assets. Use Add Funds below to deposit SOL or a fungible token.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {vaultAssets.withdrawableSol > 0 && (
                  <div className="rounded-xl border border-Heres-border bg-Heres-card/80 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-Heres-white">SOL</p>
                      <span className="rounded-md border border-Heres-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-Heres-muted">
                        Native
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-Heres-accent">
                      {formatBaseUnits(BigInt(vaultAssets.withdrawableSol), 9)} SOL
                    </p>
                  </div>
                )}
                {vaultAssets.tokens.map((token) => {
                  const mint = token.mint.toBase58()
                  return (
                    <div key={mint} className="rounded-xl border border-Heres-border bg-Heres-card/80 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-mono text-sm font-medium text-Heres-white" title={mint}>
                          {maskAddress(mint)}
                        </p>
                        <span className="rounded-md border border-Heres-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-Heres-muted">
                          {token.tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'SPL'}
                        </span>
                      </div>
                      <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-Heres-accent">
                        {formatBaseUnits(token.amount, token.decimals)}
                      </p>
                      <div className="mt-2">
                        <AddressPill address={mint} explorer="address" />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </ServiceSection>

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
                Private monitoring runs inside the TEE automatically after capsule creation. Conditions (inactivity, intent) are checked confidentially and are not visible on the public chain. The beneficiary list lives only inside the TEE while delegated; the owner can read it with a one-time auth signature. New capsules seal this list before activation so settlement cannot change after the Switch is armed.
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

          <ServiceSection title={isNft ? 'NFT Recipients & Intent' : 'Beneficiaries & Intent'} className="mb-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <p className="text-sm text-Heres-muted">
                {intentParsed?.intent
                  || (isNft
                    ? 'The human intent statement is encrypted off-chain. Each revealed on-chain NFT assignment is shown below.'
                    : 'The human intent statement is encrypted off-chain and delivered to the beneficiary via CRE. Only the on-chain beneficiary split is shown here.')}
              </p>
              {canEditBeneficiaries && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowEditBeneficiaries(true)}
                  className="shrink-0"
                  title="Edit the beneficiary list (routed privately through the TEE while delegated)."
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  Edit
                </Button>
              )}
              {capsule.inheritanceSealed && (
                <span className="shrink-0 rounded-lg border border-Heres-accent/40 px-2.5 py-1 text-xs font-medium text-Heres-accent">
                  Settlement sealed
                </span>
              )}
            </div>
            {isNft && (capsule.nftAssignments?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                {capsule.nftAssignments?.map((assignment, i) => (
                  <div
                    key={`${assignment.mint.toBase58()}-${i}`}
                    className="rounded-lg border border-Heres-border bg-Heres-card/80 px-3 py-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="min-w-0">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-Heres-muted">NFT mint</p>
                        <AddressPill address={assignment.mint.toBase58()} explorer="address" />
                      </div>
                      <div className="min-w-0">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-Heres-muted">Recipient</p>
                        <AddressPill address={assignment.recipient.toBase58()} explorer="address" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : !isNft && capsule.beneficiaries.length > 0 ? (
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
              <p className="text-sm text-Heres-muted">
                {privateStateHidden
                  ? 'Private inheritance details remain hidden in the TEE.'
                  : isNft
                    ? 'No NFT assignments set on-chain yet.'
                    : 'No beneficiaries set on-chain yet.'}
              </p>
            )}
          </ServiceSection>

          {isIntentEnabled && (
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
                    {(intentConfig?.deliveryChannel || 'email').toUpperCase()}
                  </p>
                </div>
                <div className="rounded-xl border border-Heres-border bg-Heres-card/80 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-Heres-muted mb-1">Recipient Commitment</p>
                  <p className="text-sm text-Heres-white font-mono">
                    {intentConfig?.recipientEmailHash
                      ? `${intentConfig.recipientEmailHash.slice(0, 16)}...`
                      : intentConfig?.recipientEmail
                        ? 'legacy-email-onchain'
                      : '-'}
                  </p>
                </div>
                <div className="rounded-xl border border-Heres-border bg-Heres-card/80 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-Heres-muted mb-1">Delivery Status</p>
                  {intentDeliveryLoading ? (
                    <p className="text-sm text-Heres-muted">Loading...</p>
                  ) : !wallet.connected ? (
                    <p className="text-sm text-Heres-muted">Connect wallet</p>
                  ) : !isOwner ? (
                    <p className="text-sm text-Heres-muted">Owner auth required</p>
                  ) : (
                    <p className="text-sm text-Heres-accent">{intentDeliveryStatus?.status || 'pending'}</p>
                  )}
                </div>
              </div>
              {intentDeliveryStatus?.lastError && (
                <p className="text-xs text-amber-400 mt-3">{normalizeTxError(intentDeliveryStatus.lastError)}</p>
              )}
              {intentDeliveryError && (
                <p className="text-xs text-red-400 mt-3">{intentDeliveryError}</p>
              )}
            </ServiceSection>
          )}

          {/* Actions - status-based flow */}
          {isOwner && (() => {
            const isExecuted = status === 'Executed' || (!capsule.isActive && capsule.executedAt)
            const isExpired = status === 'Expired'
            const isActive = status === 'Active'
            const isIntentDelivered =
              intentDeliveryStatus?.status === 'delivered' || intentDeliveryStatus?.status === 'dispatched'
            const isDistributed = Boolean(isExecuted && distributionComplete)
            const canExecute = isExpired && !isExecuted
            const canUndelegate = Boolean(
              isDelegated && !accountLocationsLoading && !accountLocationsError
            )
            const canDistribute = Boolean(
              isExecuted &&
              accountsOnBase &&
              !isDistributed &&
              !accountLocationsLoading &&
              !accountLocationsError &&
              !distributionLoading &&
              !distributionError
            )
            const canDispatchCre = Boolean(isExecuted && isDistributed && isIntentEnabled && !isIntentDelivered)
            const settlementReady = Boolean(isExecuted && isDistributed && (!isIntentEnabled || isIntentDelivered))
            const canFinalize = Boolean(settlementReady && !isDelegated)
            const canRefreshAutomation = Boolean((isExpired || isActive) && !isExecuted)
            // Owner early-exit (pre-fire only). Recover works even while delegated; full cancel needs
            // the accounts undelegated to base first, so it is gated on !isDelegated. Withdraw also
            // requires the vault to actually hold something - the button no longer lingers on an
            // emptied vault.
            const preFire = isCapsulePreFire(capsule.executedAt)
            const canRecover = Boolean(
              preFire &&
              vaultAssets.hasWithdrawable &&
              !vaultAssetsLoading &&
              !vaultAssetsError
            )
            const canCancel = Boolean(
              preFire &&
              accountsOnBase &&
              !accountLocationsLoading &&
              !accountLocationsError &&
              !vaultAssetsLoading &&
              !vaultAssetsError
            )
            // Deposit works regardless of delegation state: the program reads the capsule as a raw
            // AccountInfo (like recover_vault), so it no longer reverts 3007 while the Switch is
            // delegated to the ER. Both deposit and withdraw work while delegated.
            const canAddFunds = preFire && isToken

            const finalizeStep = isIntentEnabled ? 4 : 3
            const steps = [
              { num: 1, label: 'Execute Intent', desc: 'Deactivate capsule when inactivity condition met' },
              { num: 2, label: 'Distribute Assets', desc: `Transfer ${assetConfig.symbol}/tokens to beneficiaries` },
              ...(isIntentEnabled ? [{ num: 3, label: 'Deliver Intent Statement', desc: 'Dispatch encrypted intent via CRE' }] : []),
              { num: finalizeStep, label: 'Finalize Capsule', desc: 'Close settled accounts and complete this lifecycle' },
            ]

            // Determine current step (1-based)
            const currentStep = !isExecuted
              ? (canExecute ? 1 : 0)
              : !isDistributed
                ? 2
                : isIntentEnabled && !isIntentDelivered
                  ? 3
                  : finalizeStep

            return (
              <ServiceSection title="Actions" className="mb-6" tone="warning">
                {/* Status guidance */}
                <div className="rounded-lg border border-Heres-border/50 bg-Heres-surface/30 p-3 mb-5">
                  {isActive && (
                    <p className="text-sm text-Heres-muted">
                      Capsule is <span className="text-Heres-accent font-medium">Active</span>. {targetDateMs != null ? 'Neither the inactivity period nor the fixed fire date has been reached yet.' : 'The inactivity period has not elapsed yet.'} <strong>Check In</strong> any time to reset the inactivity timer. Execute and Distribute unlock once it expires; you can <strong>Add Funds</strong> or <strong>Withdraw Funds</strong> any time, or <strong>Cancel Capsule</strong> after undelegating from the ER.
                    </p>
                  )}
                  {status === 'Draft' && (
                    <p className="text-sm text-amber-400">
                      Capsule setup did not finish arming. Its assets are safe and it cannot execute. Undelegate any remaining private accounts, then cancel this draft and create it again.
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
                      {capsuleSettlementGuidance(accountLocations)}
                    </p>
                  )}
                  {!isExecuted && isDelegated && partiallyUndelegated && (
                    <p className="mt-2 text-sm text-blue-400">
                      {capsuleSettlementGuidance(accountLocations)}
                    </p>
                  )}
                  {accountLocationsError && (
                    <p className="text-sm text-amber-300">
                      {accountLocationsError} Base-layer actions remain locked until this check succeeds.
                    </p>
                  )}
                  {accountLocationsLoading && (
                    <p className="text-sm text-Heres-muted">
                      Checking the capsule switch and private beneficiary state before enabling actions...
                    </p>
                  )}
                  {distributionError && (
                    <p className="text-sm text-amber-300">
                      {distributionError}
                    </p>
                  )}
                  {vaultAssetsError && (
                    <p className="text-sm text-amber-300">
                      {vaultAssetsError}
                    </p>
                  )}
                  {isDistributed && isIntentEnabled && !isIntentDelivered && (
                    <p className="text-sm text-Heres-accent">
                      Assets already reached the beneficiary. Proceed to <strong>Deliver Intent Statement</strong> via CRE.
                    </p>
                  )}
                  {isExecuted && !isDistributed && accountsOnBase && !accountLocationsError && (
                    <p className="text-sm text-Heres-accent">
                      Capsule executed. Proceed to <strong>Distribute Assets</strong>{isIntentEnabled ? ' and then dispatch Intent Statement delivery via CRE.' : '.'}
                    </p>
                  )}
                  {settlementReady && (
                    <p className="text-sm text-green-400">
                      {isIntentEnabled
                        ? 'Assets are distributed and the intent statement is delivered. Finalize the capsule to close its on-chain accounts.'
                        : 'Assets are distributed. Finalize the capsule to close its on-chain accounts.'}
                    </p>
                  )}
                </div>

                {/* Step indicator */}
                <div className="flex items-center gap-2 mb-5 overflow-x-auto">
                  {steps.map((step, i) => {
                    const done = step.num < currentStep
                    const active = step.num === currentStep
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
                      isDistributed
                        ? 'The capsule vault is already distributed'
                        : !isExecuted
                          ? 'Execute intent first'
                          : isDelegated
                            ? partiallyUndelegated
                              ? 'Finish undelegation first'
                              : 'Undelegate from ER first'
                            : accountLocationsLoading || accountLocationsError || distributionLoading || distributionError
                              ? 'Waiting for the capsule state check'
                              : `Distribute ${assetConfig.symbol}/tokens to beneficiaries`
                    }
                  >
                    {isDistributed ? 'Assets Distributed' : 'Distribute Assets'}
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
                    title={
                      accountLocationsLoading || accountLocationsError
                        ? 'Waiting for the capsule account check'
                        : !canUndelegate
                          ? 'No delegated capsule state was found'
                          : capsuleSettlementGuidance(accountLocations)
                    }
                  >
                    {partiallyUndelegated ? 'Finish Undelegation' : 'Undelegate from ER'}
                  </Button>
                  {isIntentEnabled && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleIntentDispatch}
                      disabled={!canDispatchCre || intentDispatchLoading || !!actionLoading}
                      loading={intentDispatchLoading}
                      title={!canDispatchCre ? 'Execute intent first' : 'Dispatch encrypted intent statement via CRE'}
                    >
                      Deliver Intent Statement
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmFinalize(true)}
                    disabled={!canFinalize || !!actionLoading || intentDispatchLoading}
                    loading={actionLoading === 'finalize'}
                    title={!canFinalize ? 'Distribute every asset and complete intent delivery first' : 'Close the settled capsule accounts permanently'}
                  >
                    Finalize Capsule
                  </Button>
                  {/* Owner liveness: prove you are alive to slide the inactivity deadline forward. */}
                  {canCheckIn && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleUpdateActivity}
                      disabled={!!actionLoading}
                      loading={actionLoading === 'checkin'}
                      title="Prove liveness now - resets the inactivity timer so the capsule does not fire."
                    >
                      <HeartPulse className="h-4 w-4" aria-hidden />
                      Check In
                    </Button>
                  )}
                  {/* Owner early-exit (pre-fire): add funds, withdraw funds, or fully cancel + close. */}
                  {preFire && isToken && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowAddFunds(true)}
                      disabled={!canAddFunds || !!actionLoading}
                      title="Deposit more into this capsule's vault (deposits are repeatable)."
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      Add Funds
                    </Button>
                  )}
                  {preFire && (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setShowWithdraw(true)}
                        disabled={!canRecover || !!actionLoading}
                        title={
                          canRecover
                            ? 'Withdraw funds from the capsule back to your wallet. The capsule remains open.'
                            : vaultAssetsLoading || vaultAssetsError
                              ? 'Waiting for the vault balance check'
                              : 'No funds to withdraw'
                        }
                      >
                        Withdraw Funds
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setConfirmCancel(true)}
                        disabled={!canCancel || !!actionLoading}
                        loading={actionLoading === 'cancel'}
                        title={
                          accountLocationsLoading || accountLocationsError
                            ? 'Waiting for the capsule account check'
                            : vaultAssetsLoading || vaultAssetsError
                              ? 'Waiting for the vault balance check'
                              : !canCancel
                                ? 'Settle both capsule accounts on Solana before cancelling'
                                : 'Refund all funds + account rent and permanently close the capsule'
                        }
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
                      : actionResult.type === 'progress'
                        ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                        : 'border-red-500/30 bg-red-500/10 text-red-400'
                  }`}>
                    {actionResult.message}
                  </div>
                )}
                {intentDispatchResult && (
                  <div className={`mt-3 rounded-lg border p-3 text-sm break-all ${
                    intentDispatchResult.type === 'success'
                      ? 'border-blue-500/30 bg-blue-500/10 text-blue-400'
                      : 'border-red-500/30 bg-red-500/10 text-red-400'
                  }`}>
                    {intentDispatchResult.message}
                  </div>
                )}
              </ServiceSection>
            )
          })()}

          {!isMultiAssetVault && (
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
          )}

        </div>
      </main>
    </div>
  )
}

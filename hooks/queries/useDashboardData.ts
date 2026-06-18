'use client'

import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Connection, PublicKey } from '@solana/web3.js'
import { useHeresWallet } from '@/hooks/useHeresWallet'
import { getProgramId, getSolanaConnection } from '@/config/solana'
import { SOLANA_CONFIG, PLATFORM_FEE, HELIUS_CONFIG } from '@/constants'
import { inferAssetConfig, type SupportedAssetSymbol } from '@/lib/assets'
import { getEnhancedTransactions } from '@/lib/helius'
import { initFeeConfig } from '@/lib/solana'
import { getCapsuleVaultPDA, getFeeConfigPDA } from '@/lib/program'
import { tryDecodeIntentCapsule } from '@/lib/lean-capsule'
import { maskAddress } from '@/lib/format'
import { normalizeTxError } from '@/lib/errors'
import { useToast } from '@/components/ui'
import { queryKeys } from '@/lib/query/keys'

// ---------------------------------------------------------------------------
// Types (shared with the dashboard page render)
// ---------------------------------------------------------------------------

export type CapsuleEvent = {
  signature: string
  blockTime: number | null
  status: 'success' | 'failed'
  label: string
  logs: string[]
  capsuleAddress: string
  owner: string | null
  tokenDelta: string | null
  solDelta: number | null
  proofBytes: number | null
}

export type CapsuleRow = {
  id: string
  kind: 'capsule' | 'event'
  capsuleAddress: string
  owner: string | null
  status: string
  inactivitySeconds: number | null
  lastActivityMs: number | null
  executedAtMs: number | null
  payloadSize: number | null
  signature: string | null
  isActive: boolean | null
  events: CapsuleEvent[]
  tokenDelta: string | null
  solDelta: number | null
  proofBytes: number | null
  assetSymbol: SupportedAssetSymbol | null
  assetLabel: string | null
  totalAmount: string | null
}

export type DashboardSummary = {
  total: number
  active: number
  executed: number
  expired: number
  proofs: number
  successRate: number
  totalValueSecuredLamports: number
  totalValueExecutedLamports: number
  activeValueLockedLamports: number
  activeAssetTotals: Partial<Record<SupportedAssetSymbol, number>>
}

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

// ---------------------------------------------------------------------------
// Pure decode/aggregate helpers (moved verbatim from the page)
// ---------------------------------------------------------------------------

const normalizeSummary = (source: any): DashboardSummary => ({
  total: Number(source?.total || 0),
  active: Number(source?.active || 0),
  executed: Number(source?.executed || 0),
  expired: Number(source?.expired || 0),
  proofs: Number(source?.proofs || 0),
  successRate: Number(source?.successRate || 0),
  totalValueSecuredLamports: Number(source?.totalValueSecuredLamports || 0),
  totalValueExecutedLamports: Number(source?.totalValueExecutedLamports || 0),
  activeValueLockedLamports: Number(source?.activeValueLockedLamports || 0),
  activeAssetTotals: source?.activeAssetTotals || {},
})

const detectInstruction = (logs?: string[] | null) => {
  if (!logs || logs.length === 0) return 'system'
  const text = logs.join(' ')
  if (/create_capsule|CreateCapsule/i.test(text)) return 'create_capsule'
  if (/execute_intent|ExecuteIntent/i.test(text)) return 'execute_intent'
  if (/update_intent|UpdateIntent/i.test(text)) return 'update_intent'
  if (/update_activity|UpdateActivity/i.test(text)) return 'update_activity'
  if (/deactivate_capsule|DeactivateCapsule/i.test(text)) return 'deactivate_capsule'
  if (/recreate_capsule|RecreateCapsule/i.test(text)) return 'recreate_capsule'
  return 'system'
}

const instructionLabel = (instruction: string) => {
  switch (instruction) {
    case 'create_capsule':
      return 'Capsule Created'
    case 'execute_intent':
      return 'Capsule Executed'
    case 'update_intent':
      return 'Intent Updated'
    case 'update_activity':
      return 'Activity Updated'
    case 'deactivate_capsule':
      return 'Capsule Deactivated'
    case 'recreate_capsule':
      return 'Capsule Recreated'
    default:
      return 'System Update'
  }
}

const statusFromInstruction = (instruction: string) => {
  switch (instruction) {
    case 'create_capsule':
    case 'recreate_capsule':
      return 'Created'
    case 'execute_intent':
      return 'Executed'
    case 'update_intent':
      return 'Updated'
    case 'update_activity':
      return 'Activity'
    case 'deactivate_capsule':
      return 'Deactivated'
    default:
      return 'System'
  }
}

const fetchAllSignatures = async (
  connection: ReturnType<typeof getSolanaConnection>,
  address: PublicKey,
  pageSize = 100,
  maxPages = 10
) => {
  let all: Awaited<ReturnType<typeof connection.getSignaturesForAddress>> = []
  let before: string | undefined
  let page = 0

  while (page < maxPages) {
    const batch = await connection.getSignaturesForAddress(address, {
      limit: pageSize,
      ...(before ? { before } : {}),
    })

    all = all.concat(batch)
    if (batch.length < pageSize) break
    before = batch[batch.length - 1]?.signature
    if (!before) break
    page += 1
  }

  return all
}

/** Fetch transactions in small batches with delay to avoid 429 (Too Many Requests) on public RPC. */
const fetchTransactionsBatched = async (
  connection: ReturnType<typeof getSolanaConnection>,
  signatureInfos: Array<{ signature: string; err: any; blockTime?: number | null; memo?: string | null; slot?: number }>,
  batchSize = 3,
  delayMs = 500
): Promise<Array<{ info: (typeof signatureInfos)[0]; tx: any }>> => {
  const results: Array<{ info: (typeof signatureInfos)[0]; tx: any }> = []
  for (let i = 0; i < signatureInfos.length; i += batchSize) {
    const batch = signatureInfos.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(async (signatureInfo) => {
        try {
          const tx = await connection.getTransaction(signatureInfo.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          })
          return { info: signatureInfo, tx }
        } catch {
          return { info: signatureInfo, tx: null }
        }
      })
    )
    results.push(...batchResults)
    if (i + batchSize < signatureInfos.length && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  return results
}

const getSignatureFromTx = (tx: any) =>
  tx?.signature ||
  tx?.transactionSignature ||
  tx?.transaction?.signatures?.[0] ||
  tx?.signatures?.[0] ||
  tx?.tx?.signature ||
  ''

const getBlockTimeFromTx = (tx: any) => {
  const timestamp = tx?.timestamp || tx?.blockTime || tx?.tx?.blockTime || tx?.transaction?.blockTime
  if (!timestamp) return null
  return typeof timestamp === 'number' ? timestamp : parseInt(String(timestamp), 10)
}

/** Fetch all enhanced transactions from Helius (paginated). */
const fetchAllEnhancedTransactions = async (address: string, pageSize = 100, maxPages = 10) => {
  let all: any[] = []
  let before: string | undefined
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await getEnhancedTransactions(address, pageSize, before)
    all = all.concat(batch)
    if (batch.length < pageSize) break
    const lastSig = getSignatureFromTx(batch[batch.length - 1])
    if (!lastSig) break
    before = lastSig
  }
  return all
}

const toTxRecordFromRpc = (info: any, tx: any) => ({
  signature: info.signature,
  blockTime: info.blockTime || null,
  err: info.err || tx?.meta?.err || null,
  logs: tx?.meta?.logMessages || [],
  message: tx?.transaction?.message || null,
  meta: tx?.meta || null,
})

const getAccountKeysFromMessage = (message: any) => {
  if (!message) return []
  if (Array.isArray(message.accountKeys)) {
    return message.accountKeys.map((key: any) =>
      typeof key === 'string' ? key : key?.toBase58?.() || String(key)
    )
  }
  if (message.getAccountKeys) {
    const keys = message.getAccountKeys()
    const allKeys = [
      ...(keys.staticAccountKeys || []),
      ...(keys.accountKeysFromLookups?.writable || []),
      ...(keys.accountKeysFromLookups?.readonly || []),
    ]
    return allKeys.map((key: any) => (typeof key === 'string' ? key : key?.toBase58?.()))
  }
  return []
}

const getInstructionList = (message: any) => {
  if (!message) return []
  return message.instructions || message.compiledInstructions || []
}

const noticeSign = (value: number) => (value > 0 ? '+' : '')

const getTokenDeltaFromMeta = (meta: any) => {
  const pre = meta?.preTokenBalances || []
  const post = meta?.postTokenBalances || []
  const byMint = new Map<string, { pre: number; post: number }>()
  pre.forEach((balance: any) => {
    if (!balance?.mint) return
    const amount = Number(balance?.uiTokenAmount?.uiAmount || 0)
    byMint.set(balance.mint, { pre: amount, post: 0 })
  })
  post.forEach((balance: any) => {
    if (!balance?.mint) return
    const amount = Number(balance?.uiTokenAmount?.uiAmount || 0)
    const current = byMint.get(balance.mint) || { pre: 0, post: 0 }
    current.post = amount
    byMint.set(balance.mint, current)
  })
  const first = Array.from(byMint.entries()).find(([, value]) => value.pre !== value.post)
  if (!first) return null
  const [mint, value] = first
  const delta = value.post - value.pre
  return `${noticeSign(delta)}${delta.toFixed(4)} ${maskAddress(mint)}`
}

// ---------------------------------------------------------------------------
// The data load (queryFn). Returns a snapshot or throws. Caching + manual
// refresh that used to live in sessionStorage / refreshKey is now React Query's
// job (staleTime + refetch); the `refresh=1` API hint is driven by `forceRefresh`.
// ---------------------------------------------------------------------------

type DashboardSnapshot = { capsules: CapsuleRow[]; summary: DashboardSummary; timestamp: number }

const loadDashboard = async (
  forceRefresh: boolean,
  authHeaders?: Record<string, string>
): Promise<DashboardSnapshot> => {
  const snapshotResponse = await fetch(`/api/dashboard?history=1${forceRefresh ? '&refresh=1' : ''}`, {
    cache: 'no-store',
    ...(authHeaders ? { headers: authHeaders } : {}),
  })
  if (!snapshotResponse.ok) {
    throw new Error(`Dashboard API failed with ${snapshotResponse.status}`)
  }

  const snapshot = await snapshotResponse.json()
  if (snapshot?.capsules && snapshot?.summary) {
    return {
      capsules: snapshot.capsules,
      summary: normalizeSummary(snapshot.summary),
      timestamp: typeof snapshot.timestamp === 'number' ? snapshot.timestamp : Date.now(),
    }
  }

  const connection = getSolanaConnection()
  const programId = getProgramId()

  let accounts: any = []
  try {
    console.log('Fetching program accounts from primary RPC...')
    accounts = await connection.getProgramAccounts(programId, {
      commitment: 'confirmed',
    })
  } catch (e: any) {
    console.warn('Primary RPC failed:', e)
    // Handle 403 or other RPC failures by falling back
    if (e?.message?.includes('403') || e?.message?.includes('Forbidden') || e?.message?.includes('Bad request')) {
      console.log('Detection of 403/Forbidden. Retrying with fallback RPC...')
      try {
        const fallbackConnection = new Connection(HELIUS_CONFIG.PUBLIC_RPC_URL, 'confirmed')
        accounts = await fallbackConnection.getProgramAccounts(programId, {
          commitment: 'confirmed',
        })
        console.log('Successfully fetched from fallback RPC')
      } catch (fallbackError: any) {
        console.error('Fallback RPC also failed:', fallbackError)
        throw fallbackError
      }
    } else {
      throw e
    }
  }

  const decodedCapsules = accounts
    .map((account: any) => {
      try {
        const decoded = tryDecodeIntentCapsule(account.account.data)
        if (!decoded) return null
        return {
          capsuleAddress: account.pubkey.toBase58(),
          owner: decoded.owner.toBase58(),
          inactivityPeriod: decoded.inactivityPeriod,
          lastActivity: decoded.lastActivity,
          beneficiaries: decoded.beneficiaries,
          isActive: decoded.isActive,
          executedAt: decoded.executedAt,
        }
      } catch {
        return null
      }
    })
    .filter(Boolean) as Array<{
      capsuleAddress: string
      owner: string
      inactivityPeriod: number
      lastActivity: number
      beneficiaries: { pubkey: PublicKey; shareBps: number }[]
      isActive: boolean
      executedAt: number | null
    }>

  const nowSeconds = Math.floor(Date.now() / 1000)

  // Collect signatures: RPC first, then add any extra from Helius
  let signatureInfos: any[] = []
  try {
    signatureInfos = await fetchAllSignatures(connection, programId)
    if (SOLANA_CONFIG.HELIUS_API_KEY) {
      const enhancedTransactions = await fetchAllEnhancedTransactions(programId.toBase58())
      const heliusSigs = new Set(signatureInfos.map((s) => s.signature))
      for (const tx of enhancedTransactions) {
        const sig = getSignatureFromTx(tx)
        if (sig && !heliusSigs.has(sig)) {
          heliusSigs.add(sig)
          signatureInfos.push({
            signature: sig,
            err: null,
            blockTime: getBlockTimeFromTx(tx) || undefined,
            memo: null,
            slot: (tx?.slot || tx?.transaction?.slot || 0) as number,
          })
        }
      }
    }
  } catch (e) {
    console.warn('Failed to fetch signatures (history may be incomplete):', e)
  }

  let rpcTransactions: any[] = []
  if (signatureInfos.length > 0) {
    try {
      rpcTransactions = await fetchTransactionsBatched(connection, signatureInfos)
    } catch (e) {
      console.warn('Failed to fetch batch transactions:', e)
    }
  }

  const combinedTxMap = new Map<string, ReturnType<typeof toTxRecordFromRpc>>()
  rpcTransactions
    .map(({ info, tx }) => toTxRecordFromRpc(info, tx))
    .forEach((record) => {
      combinedTxMap.set(record.signature, record)
    })

  const transactions = Array.from(combinedTxMap.values())
  const capsuleEvents = new Map<string, CapsuleEvent[]>()
  const eventRows: CapsuleRow[] = []

  let totalProofsSubmitted = 0
  let verifiedProofs = 0

  transactions.forEach((record) => {
    const logs = record.logs || []
    const instruction = detectInstruction(logs)
    if (instruction === 'execute_intent') {
      totalProofsSubmitted += 1
      if (!record.err) verifiedProofs += 1
    }

    const message = record.message
    if (!message) return
    const accountKeys = getAccountKeysFromMessage(message)
    const instructions = getInstructionList(message)
    const programIdStr = programId.toBase58()

    instructions.forEach((ix: any) => {
      const ixProgramId = ix.programId
        ? typeof ix.programId === 'string'
          ? ix.programId
          : ix.programId.toBase58()
        : accountKeys[ix.programIdIndex]
      if (ixProgramId !== programIdStr) return

      let accountIndexes: number[] = []
      if (Array.isArray(ix.accounts) && typeof ix.accounts[0] === 'number') {
        accountIndexes = ix.accounts
      } else if (Array.isArray(ix.accounts)) {
        accountIndexes = ix.accounts.map((key: any) => {
          const keyStr = typeof key === 'string' ? key : key?.toBase58?.()
          return accountKeys.findIndex((k: string) => k === keyStr)
        })
      }

      if (accountIndexes.length < 2) return
      const capsuleKey = accountKeys[accountIndexes[0]]
      const ownerKey = accountKeys[accountIndexes[1]] || null
      if (!capsuleKey) return

      let proofBytes: number | null = null
      if (instruction === 'execute_intent' && ix.data) {
        const dataLength = typeof ix.data === 'string' ? ix.data.length : ix.data?.length || 0
        proofBytes = dataLength || null
      }

      let solDelta: number | null = null
      if (record.meta?.preBalances && record.meta?.postBalances && ownerKey) {
        const ownerIndex = accountKeys.findIndex((key: string) => key === ownerKey)
        if (ownerIndex >= 0) {
          const pre = record.meta.preBalances[ownerIndex] || 0
          const post = record.meta.postBalances[ownerIndex] || 0
          solDelta = (post - pre) / 1_000_000_000
        }
      }

      const tokenDelta = getTokenDeltaFromMeta(record.meta)

      const event: CapsuleEvent = {
        signature: record.signature,
        blockTime: record.blockTime || null,
        status: record.err ? 'failed' : 'success',
        label: instructionLabel(instruction),
        logs,
        capsuleAddress: capsuleKey,
        owner: ownerKey,
        tokenDelta,
        solDelta,
        proofBytes,
      }

      const existing = capsuleEvents.get(capsuleKey) || []
      existing.push(event)
      capsuleEvents.set(capsuleKey, existing)

      if (['create_capsule', 'recreate_capsule', 'execute_intent'].includes(instruction)) {
        eventRows.push({
          id: `event:${record.signature}`,
          kind: 'event' as const,
          capsuleAddress: capsuleKey,
          owner: ownerKey,
          status: statusFromInstruction(instruction),
          inactivitySeconds: null,
          lastActivityMs: record.blockTime ? record.blockTime * 1000 : null,
          executedAtMs: instruction === 'execute_intent' && record.blockTime ? record.blockTime * 1000 : null,
          payloadSize: null,
          signature: record.signature,
          isActive: null,
          events: [event],
          tokenDelta,
          solDelta,
          proofBytes,
          assetSymbol: null,
          assetLabel: null,
          totalAmount: null,
        } as CapsuleRow)
      }
    })
  })

  const capsuleRows: CapsuleRow[] = decodedCapsules
    .map((capsule) => {
      const executedAtMs = capsule.executedAt ? capsule.executedAt * 1000 : null
      const lastActivityMs = capsule.lastActivity * 1000
      const isExpired = capsule.executedAt === null && capsule.lastActivity + capsule.inactivityPeriod < nowSeconds
      const status = capsule.executedAt
        ? 'Executed'
        : isExpired
          ? 'Expired'
          : 'Active'
      const events = (capsuleEvents.get(capsule.capsuleAddress) || []).sort(
        (a, b) => (b.blockTime || 0) - (a.blockTime || 0)
      )
      const latestSignature = events[0]?.signature || null
      const asset = inferAssetConfig(null, null)

      return {
        id: capsule.capsuleAddress,
        kind: 'capsule' as const,
        capsuleAddress: capsule.capsuleAddress,
        owner: capsule.owner,
        status,
        inactivitySeconds: capsule.inactivityPeriod,
        lastActivityMs,
        executedAtMs,
        payloadSize: null,
        signature: latestSignature,
        isActive: capsule.isActive,
        events,
        tokenDelta: null,
        solDelta: null,
        proofBytes: null,
        assetSymbol: asset.symbol,
        assetLabel: asset.label,
        totalAmount: null,
      } as CapsuleRow
    })
    .filter((row) => {
      // Exclude waiting state: inactive, not executed, not expired (do not display)
      if (row.kind !== 'capsule') return true
      if (row.status === 'Active' && row.isActive === false) return false
      return true
    })

  const totalCreatedCapsules = eventRows.filter((row) => row.status === 'Created').length
  const activeCapsules = capsuleRows.filter((capsule) => capsule.status === 'Active').length
  const executedCapsules = capsuleRows.filter((capsule) => capsule.status === 'Executed').length
  const expiredCapsules = capsuleRows.filter((capsule) => capsule.status === 'Expired').length
  const successRate =
    totalProofsSubmitted > 0 ? (verifiedProofs / totalProofsSubmitted) * 100 : 0
  const totalValueSecuredLamports = transactions.reduce((sum, record) => {
    const locked = (record.logs || []).reduce((logSum: number, log: string) => {
      const amount = log.match(/Locked (\d+) lamports in vault/i)?.[1]
      return logSum + Number(amount || 0)
    }, 0)
    return sum + locked
  }, 0)
  const totalValueExecutedLamports = transactions.reduce((sum, record) => {
    const transferred = (record.logs || []).reduce((logSum: number, log: string) => {
      const amount = log.match(/Transferred (\d+) to beneficiary/i)?.[1]
      return logSum + Number(amount || 0)
    }, 0)
    return sum + transferred
  }, 0)

  let activeValueLockedLamports = 0
  const activeAssetTotals: Partial<Record<SupportedAssetSymbol, number>> = {}
  if (capsuleRows.length > 0) {
    capsuleRows.forEach((capsule) => {
      if (capsule.status !== 'Active' || !capsule.assetSymbol || !capsule.totalAmount) return
      const amount = Number.parseFloat(capsule.totalAmount)
      if (!Number.isFinite(amount)) return
      activeAssetTotals[capsule.assetSymbol] = (activeAssetTotals[capsule.assetSymbol] || 0) + amount
    })
    try {
      const rentExemptLamports = await connection.getMinimumBalanceForRentExemption(9)
      const activeVaultPdas = capsuleRows
        .filter((capsule) => capsule.status === 'Active' && capsule.owner)
        .map((capsule) => getCapsuleVaultPDA(new PublicKey(capsule.owner!))[0])
      if (activeVaultPdas.length > 0) {
        const vaultInfos = await connection.getMultipleAccountsInfo(activeVaultPdas)
        activeValueLockedLamports = vaultInfos.reduce(
          (sum, accountInfo) => sum + Math.max(0, (accountInfo?.lamports || 0) - rentExemptLamports),
          0
        )
      }
    } catch {
      activeValueLockedLamports = 0
    }
  }

  const combinedRows: CapsuleRow[] = [...capsuleRows, ...eventRows].sort((a, b) => {
    const aTime = a.lastActivityMs || a.executedAtMs || 0
    const bTime = b.lastActivityMs || b.executedAtMs || 0
    return bTime - aTime
  })

  const summaryData = {
    total: Math.max(totalCreatedCapsules, decodedCapsules.length),
    active: activeCapsules,
    executed: executedCapsules,
    expired: expiredCapsules,
    proofs: verifiedProofs,
    successRate,
    totalValueSecuredLamports,
    totalValueExecutedLamports,
    activeValueLockedLamports,
    activeAssetTotals,
  }

  return { capsules: combinedRows, summary: normalizeSummary(summaryData), timestamp: Date.now() }
}

const checkFeeConfigExists = async (): Promise<boolean> => {
  const connection = getSolanaConnection()
  const [feeConfigPDA] = getFeeConfigPDA()
  const account = await connection.getAccountInfo(feeConfigPDA)
  return account != null
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseDashboardData {
  capsules: CapsuleRow[]
  summary: DashboardSummary
  error: string | null
  lastUpdated: number | null
  isRefreshing: boolean
  feeConfigExists: boolean | null
  refresh: () => void
  initFee: {
    run: () => Promise<void>
    pending: boolean
    tx: string | null
    error: string | null
  }
}

export interface UseDashboardDataOptions {
  /**
   * Supplies admin auth headers for the gated /api/dashboard feed. Called at fetch
   * time so a fresh (or cached) signature is used on every refetch. Omit for the
   * legacy unauthenticated path (no consumer ships that anymore).
   */
  adminAuthHeaders?: () => Promise<Record<string, string>>
  /** When false, both queries are disabled (e.g. before an admin authenticates). */
  enabled?: boolean
}

export function useDashboardData(options: UseDashboardDataOptions = {}): UseDashboardData {
  const { adminAuthHeaders, enabled = true } = options
  const wallet = useHeresWallet()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Manual refresh appends `&refresh=1` to the API. React Query has no native
  // "this is a forced refetch" signal, so a ref carries the flag through refetch().
  const forceRefreshRef = useRef(false)

  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard.data(),
    enabled,
    // queryFn closes over the latest `adminAuthHeaders`: useQuery adopts the new
    // function each render, so the next fetch always uses the current provider.
    queryFn: async () => {
      const force = forceRefreshRef.current
      forceRefreshRef.current = false
      const headers = adminAuthHeaders ? await adminAuthHeaders() : undefined
      return loadDashboard(force, headers)
    },
    staleTime: 5 * 60 * 1000, // replaces the old 5-min sessionStorage cache
    retry: 0, // the load already has internal API->RPC->Helius fallbacks; one heavy attempt
  })

  const feeConfigQuery = useQuery({
    queryKey: queryKeys.dashboard.feeConfig(),
    enabled,
    queryFn: checkFeeConfigExists,
  })

  const [initFeePending, setInitFeePending] = useState(false)
  const [initFeeTx, setInitFeeTx] = useState<string | null>(null)
  const [initFeeError, setInitFeeError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    forceRefreshRef.current = true
    dashboardQuery.refetch()
    feeConfigQuery.refetch()
  }, [dashboardQuery, feeConfigQuery])

  const handleInitFeeConfig = useCallback(async () => {
    if (!wallet.publicKey || !SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT) return
    setInitFeePending(true)
    setInitFeeError(null)
    setInitFeeTx(null)
    try {
      const recipient = new PublicKey(SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT)
      const tx = await initFeeConfig(wallet, recipient, PLATFORM_FEE.CREATION_FEE_LAMPORTS)
      setInitFeeTx(tx)
      queryClient.setQueryData(queryKeys.dashboard.feeConfig(), true)
      toast({ message: 'Fee config initialized successfully.', variant: 'success' })
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (/already in use|AccountDidNotSerialize|0x0/i.test(msg)) {
        setInitFeeError('Fee config already initialized.')
        queryClient.setQueryData(queryKeys.dashboard.feeConfig(), true)
        toast({ message: 'Fee config already initialized.', variant: 'info' })
      } else {
        setInitFeeError(msg)
        toast({ message: normalizeTxError(e), variant: 'error' })
      }
    } finally {
      setInitFeePending(false)
    }
  }, [wallet, toast, queryClient])

  return {
    capsules: dashboardQuery.data?.capsules ?? [],
    summary: dashboardQuery.data?.summary ?? EMPTY_SUMMARY,
    error: dashboardQuery.isError
      ? 'Unable to load on-chain capsule data. Please check RPC connectivity.'
      : null,
    lastUpdated: dashboardQuery.data?.timestamp ?? null,
    isRefreshing: dashboardQuery.isFetching,
    feeConfigExists: feeConfigQuery.data ?? null,
    refresh,
    initFee: {
      run: handleInitFeeConfig,
      pending: initFeePending,
      tx: initFeeTx,
      error: initFeeError,
    },
  }
}

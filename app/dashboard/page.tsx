'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Database,
  RefreshCw,
  Settings,
  User,
} from 'lucide-react'
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { useWallet } from '@solana/wallet-adapter-react'
import { getProgramId, getSolanaConnection } from '@/config/solana'
import { SOLANA_CONFIG, PLATFORM_FEE, HELIUS_CONFIG, getExplorerUrl } from '@/constants'
import { inferAssetConfig, SupportedAssetSymbol } from '@/lib/assets'
import { getEnhancedTransactions } from '@/lib/helius'
import { initFeeConfig } from '@/lib/solana'
import { getCapsuleVaultPDA, getFeeConfigPDA } from '@/lib/program'
import { SectionEyebrow, ServicePageHeader } from '@/components/ui/service-page'
import { tryDecodeIntentCapsule } from '@/lib/lean-capsule'
import {
  Button,
  AddressPill,
  StatTile,
  StatusChip,
  useToast,
} from '@/components/ui'
import { maskAddress, timeAgo, formatDateTime } from '@/lib/format'
import { normalizeTxError } from '@/lib/errors'

type CapsuleEvent = {
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

type CapsuleRow = {
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

const toTxRecordFromEnhanced = (tx: any) => ({
  signature: getSignatureFromTx(tx),
  blockTime: getBlockTimeFromTx(tx),
  err: tx?.err || tx?.meta?.err || tx?.transactionError || null,
  logs: tx?.meta?.logMessages || tx?.logs || [],
  message: tx?.transaction?.message || tx?.tx?.message || tx?.message || null,
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

export default function DashboardPage() {
  const wallet = useWallet()
  const { toast } = useToast()
  const [capsules, setCapsules] = useState<CapsuleRow[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'created' | 'executed' | 'active' | 'expired'>('all')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [zkProofHash, setZkProofHash] = useState<string | null>(null)
  const [zkPublicInputsHash, setZkPublicInputsHash] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [feeConfigExists, setFeeConfigExists] = useState<boolean | null>(null)
  const [initFeePending, setInitFeePending] = useState(false)
  const [initFeeTx, setInitFeeTx] = useState<string | null>(null)
  const [initFeeError, setInitFeeError] = useState<string | null>(null)
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    executed: 0,
    expired: 0,
    proofs: 0,
    successRate: 0,
    totalValueSecuredLamports: 0,
    totalValueExecutedLamports: 0,
    activeValueLockedLamports: 0,
    activeAssetTotals: {} as Partial<Record<SupportedAssetSymbol, number>>,
  })

  const normalizeSummary = (source: any) => ({
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

  useEffect(() => {
    // Magicblock PER (TEE) context / commit (fallback to legacy zk keys)
    const erContextKey = 'er_context_global'
    const erCommitKey = 'er_commit_hash_global'
    const legacyProofKey = 'zk_proof_hash_global'
    const legacyInputsKey = 'zk_inputs_hash_global'
    setZkProofHash(localStorage.getItem(erContextKey) || localStorage.getItem(legacyProofKey))
    setZkPublicInputsHash(localStorage.getItem(erCommitKey) || localStorage.getItem(legacyInputsKey))
  }, [])

  // Check if fee_config PDA exists (admin-only one-time setup)
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const connection = getSolanaConnection()
        const [feeConfigPDA] = getFeeConfigPDA()
        const account = await connection.getAccountInfo(feeConfigPDA)
        if (!cancelled) setFeeConfigExists(account != null)
      } catch {
        if (!cancelled) setFeeConfigExists(null)
      }
    }
    check()
    return () => { cancelled = true }
  }, [refreshKey])

  const handleInitFeeConfig = useCallback(async () => {
    if (!wallet.publicKey || !SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT) return
    setInitFeePending(true)
    setInitFeeError(null)
    setInitFeeTx(null)
    try {
      const recipient = new PublicKey(SOLANA_CONFIG.PLATFORM_FEE_RECIPIENT)
      const tx = await initFeeConfig(wallet, recipient, PLATFORM_FEE.CREATION_FEE_LAMPORTS)
      setInitFeeTx(tx)
      setFeeConfigExists(true)
      toast({ message: 'Fee config initialized successfully.', variant: 'success' })
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (/already in use|AccountDidNotSerialize|0x0/i.test(msg)) {
        setInitFeeError('Fee config already initialized.')
        setFeeConfigExists(true)
        toast({ message: 'Fee config already initialized.', variant: 'info' })
      } else {
        setInitFeeError(msg)
        toast({ message: normalizeTxError(e), variant: 'error' })
      }
    } finally {
      setInitFeePending(false)
    }
  }, [wallet, toast])

  useEffect(() => {
    let isMounted = true

    const DASHBOARD_CACHE_KEY = 'dashboard_cache'
    const DASHBOARD_CACHE_TTL = 5 * 60 * 1000 // 5 min

    const loadDashboard = async () => {
      // Try sessionStorage cache first (skip on manual refresh)
      if (refreshKey === 0) {
        try {
          const cached = sessionStorage.getItem(DASHBOARD_CACHE_KEY)
          if (cached) {
            const { data, timestamp } = JSON.parse(cached)
            if (Date.now() - timestamp < DASHBOARD_CACHE_TTL && data) {
              if (isMounted) {
                setCapsules(data.capsules)
                setSummary(data.summary)
                setLastUpdated(timestamp)
                setError(null)
                setIsRefreshing(false)
              }
              return
            }
          }
        } catch { /* ignore cache read errors */ }
      }

      setIsRefreshing(true)
      try {
        const snapshotResponse = await fetch(`/api/dashboard?history=1${refreshKey > 0 ? '&refresh=1' : ''}`, {
          cache: 'no-store',
        })
        if (!snapshotResponse.ok) {
          throw new Error(`Dashboard API failed with ${snapshotResponse.status}`)
        }

        const snapshot = await snapshotResponse.json()
        if (snapshot?.capsules && snapshot?.summary) {
          if (isMounted) {
            setCapsules(snapshot.capsules)
            setSummary(normalizeSummary(snapshot.summary))
            setLastUpdated(typeof snapshot.timestamp === 'number' ? snapshot.timestamp : Date.now())
            setError(null)

            try {
              sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
                data: {
                  capsules: snapshot.capsules,
                  summary: normalizeSummary(snapshot.summary),
                },
                timestamp: typeof snapshot.timestamp === 'number' ? snapshot.timestamp : Date.now(),
              }))
            } catch { /* ignore quota errors */ }
          }
          return
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

        if (isMounted) {
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
          setCapsules(combinedRows)
          setSummary(normalizeSummary(summaryData))
          setLastUpdated(Date.now())
          setError(null)

          // Cache to sessionStorage
          try {
            sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
              data: { capsules: combinedRows, summary: normalizeSummary(summaryData) },
              timestamp: Date.now(),
            }))
          } catch { /* ignore quota errors */ }
        }
      } catch (err) {
        if (isMounted) {
          setError('Unable to load on-chain capsule data. Please check RPC connectivity.')
        }
      } finally {
        if (isMounted) setIsRefreshing(false)
      }
    }

    loadDashboard()

    return () => {
      isMounted = false
    }
  }, [refreshKey])

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
            eyebrow={<SectionEyebrow>Protocol Monitor</SectionEyebrow>}
            title="Heres Capsules"
            description="Track capsule status, PER (TEE) execution, and verification on the active Solana cluster."
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
                  onClick={() => setRefreshKey((k) => k + 1)}
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
          {wallet.connected && feeConfigExists === false && (
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
                  onClick={handleInitFeeConfig}
                  disabled={initFeePending}
                  loading={initFeePending}
                >
                  {initFeePending ? 'Processing...' : 'Initialize Fee Config'}
                </Button>
              </div>
              {initFeeTx && (
                <p className="mt-3 text-sm text-Heres-accent">
                  Success:{' '}
                  <a
                    href={getExplorerUrl('tx', initFeeTx)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    View transaction
                  </a>
                </p>
              )}
              {initFeeError && (
                <p className="mt-3 text-sm text-amber-400">{initFeeError}</p>
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

import { Connection, PublicKey } from '@solana/web3.js'
import { Redis } from '@upstash/redis'
import { getProgramId, getSolanaConnection, getSolanaFallbackConnection } from '@/config/solana'
import { HELIUS_CONFIG, MAGICBLOCK_ER } from '@/constants'
import { inferAssetConfig, SupportedAssetSymbol } from '@/lib/assets'
import { getRegisteredOwners, registerCapsuleOwner } from '@/lib/capsule-registry'
import { parseIntentPayload } from '@/utils/intent'
import { debugLog, debugWarn } from '@/lib/log'
import { loadDurableSnapshot, saveDurableSnapshot, persistDashboardIndex, loadSyncCheckpoint, saveSyncCheckpoint } from '@/lib/dashboard-store'
import { getCapsulePDA, getCapsuleVaultPDA } from '@/lib/program'

export type DashboardCapsuleEvent = {
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

export type DashboardCapsuleRow = {
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
  isDelegated: boolean
  events: DashboardCapsuleEvent[]
  tokenDelta: string | null
  solDelta: number | null
  proofBytes: number | null
  assetSymbol: SupportedAssetSymbol | null
  assetLabel: string | null
  totalAmount: string | null
}

export type DashboardSummary = {
  total: number
  allTimeCreated: number | null
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

export type DashboardSnapshot = {
  capsules: DashboardCapsuleRow[]
  summary: DashboardSummary
  timestamp: number
  historyLoaded: boolean
  complete: boolean
}

export type CapsuleListFilter = 'all' | 'live' | 'created' | 'executed' | 'active' | 'expired'
export type CapsuleListSort = 'newest' | 'oldest'

export type CapsuleListItem = Omit<DashboardCapsuleRow, 'events'> & {
  eventCount: number
}

export type CapsuleListResponse = {
  items: CapsuleListItem[]
  page: number
  limit: number
  total: number
  totalPages: number
  timestamp: number
  complete: boolean
}

export type CapsuleSummaryResponse = {
  summary: DashboardSummary
  timestamp: number
  complete: boolean
}

type PersistedCacheEnvelope<T> = {
  value: T
  updatedAt: number
}

declare global {
  // eslint-disable-next-line no-var
  var __heresDashboardPrewarmStarted: boolean | undefined
  // eslint-disable-next-line no-var
  var __heresDashboardPrewarmTimer: NodeJS.Timeout | undefined
}

type TxRecord = {
  signature: string
  blockTime: number | null
  err: any
  logs: string[]
  message: any
  meta: any
}

type DashboardHistoryIndex = {
  v: 3
  programId: string
  latestSignature: string | null
  oldestSignature: string | null
  scanComplete: boolean
  eventRows: DashboardCapsuleRow[]
  capsuleEventsByCapsule: Record<string, DashboardCapsuleEvent[]>
  allTimeCreated: number
  totalProofsSubmitted: number
  verifiedProofs: number
  totalValueSecuredLamports: number
  totalValueExecutedLamports: number
  updatedAt: number
}

type DashboardHistoryMetrics = {
  eventRows: DashboardCapsuleRow[]
  capsuleEventsByCapsule: Record<string, DashboardCapsuleEvent[]>
  allTimeCreated: number
  totalProofsSubmitted: number
  verifiedProofs: number
  totalValueSecuredLamports: number
  totalValueExecutedLamports: number
}

type SignatureFetchResult = {
  signatures: Awaited<ReturnType<Connection['getSignaturesForAddress']>>
  exhausted: boolean
}

const DASHBOARD_CACHE_TTL_MS = 30_000
const DASHBOARD_RESPONSE_CACHE_TTL_MS = 30_000
const DASHBOARD_RESPONSE_CACHE_STALE_MS = 5 * 60_000
const DASHBOARD_PREWARM_INTERVAL_MS = 120_000
const DASHBOARD_INDEX_FRESH_MS = 60_000
const DASHBOARD_INDEX_MAX_STALE_MS = 15 * 60_000
const OWNER_FETCH_CONCURRENCY = 4
const ACCOUNT_INFO_BATCH_SIZE = 100
const PROGRAM_SIGNATURE_MAX_PAGES = 500
const PROGRAM_SIGNATURE_INCREMENTAL_PAGES = 10
const PROGRAM_SIGNATURE_BACKFILL_PAGES = 10
const DASHBOARD_HISTORY_KEY_PREFIX = 'dashboard:history:'
const DASHBOARD_RESPONSE_CACHE_KEY_PREFIX = 'dashboard:response:'
const DASHBOARD_HISTORY_SCHEMA_VERSION = 3
const dashboardCache = new Map<string, { snapshot: DashboardSnapshot; expiresAt: number }>()
const inFlightSnapshots = new Map<string, Promise<DashboardSnapshot>>()
const feeConfigCache = new Map<string, { value: boolean; expiresAt: number }>()
const responseCache = new Map<string, PersistedCacheEnvelope<unknown>>()
const inFlightResponseRefreshes = new Map<string, Promise<unknown>>()

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

function getHistoryLocalPath(programId: string): string {
  const path = require('path')
  return path.join(process.cwd(), '.data', `dashboard-history-${programId}.json`)
}

async function loadDashboardHistoryIndex(programId: string): Promise<DashboardHistoryIndex | null> {
  const redis = getRedis()
  const key = `${DASHBOARD_HISTORY_KEY_PREFIX}${programId}`

  if (redis) {
    const raw = await redis.get<string>(key)
    if (raw) {
      const parsed = typeof raw === 'string'
        ? (JSON.parse(raw) as DashboardHistoryIndex)
        : (raw as unknown as DashboardHistoryIndex)
      if (parsed?.v === DASHBOARD_HISTORY_SCHEMA_VERSION) return parsed
    }
  }

  const durable = await loadSyncCheckpoint<DashboardHistoryIndex>(key)
  if (durable?.v === DASHBOARD_HISTORY_SCHEMA_VERSION) {
    return durable
  }

  try {
    const fs = require('fs')
    const localPath = getHistoryLocalPath(programId)
    if (!fs.existsSync(localPath)) return null
    const parsed = JSON.parse(fs.readFileSync(localPath, 'utf8')) as DashboardHistoryIndex
    return parsed?.v === DASHBOARD_HISTORY_SCHEMA_VERSION ? parsed : null
  } catch {
    return null
  }
}

async function saveDashboardHistoryIndex(index: DashboardHistoryIndex): Promise<void> {
  const redis = getRedis()
  const key = `${DASHBOARD_HISTORY_KEY_PREFIX}${index.programId}`

  if (redis) {
    await redis.set(key, JSON.stringify(index))
  }

  await saveSyncCheckpoint(key, index)

  try {
    const fs = require('fs')
    const path = require('path')
    const localPath = getHistoryLocalPath(index.programId)
    const dir = path.dirname(localPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const tempPath = `${localPath}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(index))
    fs.renameSync(tempPath, localPath)
  } catch (error) {
    debugWarn('[dashboard] failed to persist dashboard history index', error)
  }
}

async function loadPersistedResponseCache<T>(cacheKey: string): Promise<PersistedCacheEnvelope<T> | null> {
  const memoryCached = responseCache.get(cacheKey) as PersistedCacheEnvelope<T> | undefined
  if (memoryCached) return memoryCached

  const redis = getRedis()
  if (!redis) return null

  const raw = await redis.get<string>(`${DASHBOARD_RESPONSE_CACHE_KEY_PREFIX}${cacheKey}`)
  if (!raw) return null
  const parsed = typeof raw === 'string'
    ? (JSON.parse(raw) as PersistedCacheEnvelope<T>)
    : (raw as unknown as PersistedCacheEnvelope<T>)
  responseCache.set(cacheKey, parsed as PersistedCacheEnvelope<unknown>)
  return parsed
}

async function savePersistedResponseCache<T>(cacheKey: string, value: T): Promise<void> {
  const envelope: PersistedCacheEnvelope<T> = {
    value,
    updatedAt: Date.now(),
  }
  responseCache.set(cacheKey, envelope as PersistedCacheEnvelope<unknown>)

  const redis = getRedis()
  if (!redis) return
  await redis.set(`${DASHBOARD_RESPONSE_CACHE_KEY_PREFIX}${cacheKey}`, JSON.stringify(envelope))
}

function getSnapshotPersistKey(cacheKey: string): string {
  return `dashboard:snapshot:${cacheKey}`
}

async function loadPersistedDashboardSnapshot(cacheKey: string): Promise<PersistedCacheEnvelope<DashboardSnapshot> | null> {
  const redisSnapshot = await loadPersistedResponseCache<DashboardSnapshot>(getSnapshotPersistKey(cacheKey))
  if (redisSnapshot) return redisSnapshot
  return await loadDurableSnapshot(cacheKey)
}

async function savePersistedDashboardSnapshot(cacheKey: string, snapshot: DashboardSnapshot): Promise<void> {
  await savePersistedResponseCache(getSnapshotPersistKey(cacheKey), snapshot)
  await saveDurableSnapshot(cacheKey, snapshot)
  await persistDashboardIndex(snapshot)
}

function primeDashboardSnapshotCache(cacheKey: string, snapshot: DashboardSnapshot): void {
  dashboardCache.set(cacheKey, {
    snapshot,
    expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
  })
}

async function refreshDashboardSnapshot(cacheKey: string, includeHistory: boolean, fullScan: boolean): Promise<DashboardSnapshot> {
  const inFlight = inFlightSnapshots.get(cacheKey)
  if (inFlight) return inFlight

  const nextSnapshot = buildDashboardSnapshot(includeHistory, fullScan, true)
    .then(async (snapshot) => {
      primeDashboardSnapshotCache(cacheKey, snapshot)
      await savePersistedDashboardSnapshot(cacheKey, snapshot)
      return snapshot
    })
    .finally(() => {
      inFlightSnapshots.delete(cacheKey)
    })

  inFlightSnapshots.set(cacheKey, nextSnapshot)
  return nextSnapshot
}

function triggerDashboardSnapshotRefresh(cacheKey: string, includeHistory: boolean, fullScan: boolean): void {
  void refreshDashboardSnapshot(cacheKey, includeHistory, fullScan).catch((error) => {
    debugWarn(`[dashboard] background snapshot refresh failed for ${cacheKey}`, error)
  })
}

function shouldEnableDashboardPrewarm(): boolean {
  return process.env.DASHBOARD_PREWARM_ENABLED !== '0'
}

function getDashboardPrewarmPages(): number[] {
  const raw = process.env.DASHBOARD_PREWARM_PAGES || '1,2,3'
  const pages = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 1)
  return pages.length ? Array.from(new Set(pages)) : [1, 2, 3]
}

async function prewarmDashboardResponses(forceRefresh = false): Promise<void> {
  const cacheKey = 'full:fast'

  if (forceRefresh) {
    await refreshDashboardSnapshot(cacheKey, true, false)
  } else {
    await getDashboardSnapshot(false, true, false)
    triggerDashboardSnapshotRefresh(cacheKey, true, false)
  }

  await getFeeConfigStatus(forceRefresh)
}

async function getCachedResponse<T>(
  cacheKey: string,
  builder: () => Promise<T>,
  forceRefresh = false
): Promise<T> {
  const now = Date.now()
  const cached = !forceRefresh ? await loadPersistedResponseCache<T>(cacheKey) : null

  if (cached) {
    const age = now - cached.updatedAt
    if (age <= DASHBOARD_RESPONSE_CACHE_TTL_MS) {
      return cached.value
    }

    if (age <= DASHBOARD_RESPONSE_CACHE_STALE_MS) {
      if (!inFlightResponseRefreshes.has(cacheKey)) {
        const refreshPromise = builder()
          .then(async (value) => {
            await savePersistedResponseCache(cacheKey, value)
            return value
          })
          .finally(() => {
            inFlightResponseRefreshes.delete(cacheKey)
          })
        inFlightResponseRefreshes.set(cacheKey, refreshPromise as Promise<unknown>)
      }
      return cached.value
    }
  }

  const inFlight = !forceRefresh ? inFlightResponseRefreshes.get(cacheKey) as Promise<T> | undefined : undefined
  if (inFlight) {
    return inFlight
  }

  const buildPromise = builder()
    .then(async (value) => {
      await savePersistedResponseCache(cacheKey, value)
      return value
    })
    .finally(() => {
      inFlightResponseRefreshes.delete(cacheKey)
    })

  inFlightResponseRefreshes.set(cacheKey, buildPromise as Promise<unknown>)
  return buildPromise
}

const detectInstruction = (logs?: string[] | null) => {
  if (!logs || logs.length === 0) return 'system'
  const text = logs.join(' ')
  if (/create_capsule|CreateCapsule/i.test(text)) return 'create_capsule'
  if (/execute_intent|ExecuteIntent/i.test(text)) return 'execute_intent'
  if (/distribute_assets|DistributeAssets/i.test(text)) return 'distribute_assets'
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
      return 'Intent Verified'
    case 'distribute_assets':
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
      return 'Verified'
    case 'distribute_assets':
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

const maskAddress = (address: string) =>
  address.length > 10 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address

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

const decodeCapsuleAccount = (data: Uint8Array) => {
  if (!data || data.length < 60) return null

  const readI64 = (bytes: Uint8Array, start: number): bigint => {
    let result = 0n
    for (let i = 0; i < 8; i += 1) {
      result |= BigInt(bytes[start + i]) << BigInt(i * 8)
    }
    if (result & (1n << 63n)) {
      result = result - (1n << 64n)
    }
    return result
  }

  const readU32 = (bytes: Uint8Array, start: number): number =>
    bytes[start] | (bytes[start + 1] << 8) | (bytes[start + 2] << 16) | (bytes[start + 3] << 24)

  let offset = 8
  const ownerBytes = data.slice(offset, offset + 32)
  const owner = new PublicKey(ownerBytes)
  offset += 32
  const inactivityPeriod = Number(readI64(data, offset))
  offset += 8
  const lastActivity = Number(readI64(data, offset))
  offset += 8
  const intentDataLength = readU32(data, offset)
  offset += 4
  const intentDataBytes = data.slice(offset, offset + intentDataLength)
  offset += intentDataLength
  const isActive = data[offset] === 1
  offset += 1
  const hasExecutedAt = data[offset] === 1
  offset += 1
  let executedAt: number | null = null
  if (hasExecutedAt) {
    executedAt = Number(readI64(data, offset))
  }

  return {
    owner,
    inactivityPeriod,
    lastActivity,
    intentData: new Uint8Array(intentDataBytes),
    isActive,
    executedAt,
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let currentIndex = 0

  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (currentIndex < items.length) {
      const nextIndex = currentIndex
      currentIndex += 1
      results[nextIndex] = await worker(items[nextIndex])
    }
  })

  await Promise.all(runners)
  return results
}

async function getMultipleAccountsInfoBatched(
  connection: Connection,
  publicKeys: PublicKey[]
): Promise<Array<any | null>> {
  if (!publicKeys.length) return []

  const batches: Array<PublicKey[]> = []
  for (let index = 0; index < publicKeys.length; index += ACCOUNT_INFO_BATCH_SIZE) {
    batches.push(publicKeys.slice(index, index + ACCOUNT_INFO_BATCH_SIZE))
  }

  // Batch account reads so large active capsule sets do not trigger one RPC request per vault.
  const accountInfoBatches = await Promise.all(
    batches.map((batch) => connection.getMultipleAccountsInfo(batch, 'confirmed'))
  )

  return accountInfoBatches.flat()
}

async function fetchAllSignatures(
  connection: Connection,
  address: PublicKey,
  pageSize = 100,
  maxPages = PROGRAM_SIGNATURE_MAX_PAGES,
  untilSignature?: string,
  startBeforeSignature?: string
): Promise<SignatureFetchResult> {
  let all: Awaited<ReturnType<typeof connection.getSignaturesForAddress>> = []
  let before: string | undefined = startBeforeSignature
  let exhausted = false

  for (let page = 0; page < maxPages; page += 1) {
    const batch = await connection.getSignaturesForAddress(address, {
      limit: pageSize,
      ...(before ? { before } : {}),
    })

    if (!batch.length) {
      exhausted = true
      break
    }

    if (untilSignature) {
      const untilIndex = batch.findIndex((entry) => entry.signature === untilSignature)
      if (untilIndex >= 0) {
        all = all.concat(batch.slice(0, untilIndex))
        exhausted = true
        break
      }
    }

    all = all.concat(batch)
    if (batch.length < pageSize) {
      exhausted = true
      break
    }
    before = batch[batch.length - 1]?.signature
    if (!before) break
  }

  return { signatures: all, exhausted }
}

async function fetchTransactionsBatched(
  connection: Connection,
  signatureInfos: Array<{ signature: string; err: any; blockTime?: number | null; memo?: string | null; slot?: number }>,
  batchSize = 20
): Promise<Array<{ info: (typeof signatureInfos)[0]; tx: any }>> {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const results: Array<{ info: (typeof signatureInfos)[0]; tx: any }> = []
  for (let i = 0; i < signatureInfos.length; i += batchSize) {
    const batch = signatureInfos.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(async (signatureInfo) => {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            const tx = await connection.getTransaction(signatureInfo.signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            })
            return { info: signatureInfo, tx }
          } catch {
            if (attempt === 3) break
            await delay(250 * (attempt + 1))
          }
        }
        return { info: signatureInfo, tx: null }
      })
    )
    results.push(...batchResults)
  }
  return results
}

async function fetchProgramHistoryTransactions(
  connection: Connection,
  programId: PublicKey,
  untilSignature?: string,
  maxPages = PROGRAM_SIGNATURE_MAX_PAGES,
  startBeforeSignature?: string
): Promise<{ transactions: TxRecord[]; exhausted: boolean }> {
  const { signatures: signatureInfos, exhausted } = await fetchAllSignatures(
    connection,
    programId,
    100,
    maxPages,
    untilSignature,
    startBeforeSignature
  )
  if (!signatureInfos.length) return { transactions: [], exhausted }
  const rpcTransactions = await fetchTransactionsBatched(connection, signatureInfos)
  return {
    transactions: rpcTransactions
      .map(({ info, tx }) => toTxRecordFromRpc(info, tx))
      .filter((record) => Boolean(record.signature)),
    exhausted,
  }
}

async function fetchCapsulesFromRegistry() {
  const owners = await getRegisteredOwners()
  if (!owners.length) {
    return [] as Array<{
      capsuleAddress: string
      owner: string
      inactivityPeriod: number
      lastActivity: number
      intentData: Uint8Array
      isActive: boolean
      executedAt: number | null
      isDelegated: boolean
    }>
  }

  const connection = getSolanaConnection()
  const fallbackConnection = getSolanaFallbackConnection()
  const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
  const ownerEntries = owners.flatMap((owner) => {
    try {
      const ownerKey = new PublicKey(owner)
      const [capsulePda] = getCapsulePDA(ownerKey)
      return [{ owner, capsulePda }]
    } catch {
      debugWarn(`[dashboard] skipping invalid registered owner ${owner}`)
      return []
    }
  })

  let accountInfos: Array<any | null> = []
  try {
    accountInfos = await getMultipleAccountsInfoBatched(
      connection,
      ownerEntries.map((entry) => entry.capsulePda)
    )
  } catch (error) {
    debugWarn('[dashboard] registry capsule batch fetch failed on primary RPC, retrying on fallback', error)
    accountInfos = await getMultipleAccountsInfoBatched(
      fallbackConnection,
      ownerEntries.map((entry) => entry.capsulePda)
    )
  }

  const delegatedIndexes = ownerEntries
    .map((_, index) => index)
    .filter((index) => accountInfos[index]?.owner?.equals(delegationProgramId))
  if (delegatedIndexes.length) {
    try {
      const { Connection: SolConnection } = require('@solana/web3.js')
      const erConn = new SolConnection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
      const erInfos = await getMultipleAccountsInfoBatched(
        erConn,
        delegatedIndexes.map((index) => ownerEntries[index].capsulePda)
      )
      delegatedIndexes.forEach((ownerIndex, delegatedIndex) => {
        const erInfo = erInfos[delegatedIndex]
        if (ownerIndex >= 0 && erInfo?.data) {
          accountInfos[ownerIndex] = {
            ...accountInfos[ownerIndex],
            data: erInfo.data,
          }
        }
      })
    } catch (error) {
      debugWarn('[dashboard] failed to refresh delegated registry capsules from ER RPC', error)
    }
  }

  const settled = ownerEntries.map((entry, index) => {
    try {
      const accountInfo = accountInfos[index]
      if (!accountInfo?.data) return null
      const capsule = decodeCapsuleAccount(accountInfo.data)
      if (!capsule) return null

      return {
        capsuleAddress: entry.capsulePda.toBase58(),
        owner: entry.owner,
        inactivityPeriod: capsule.inactivityPeriod,
        lastActivity: capsule.lastActivity,
        intentData: capsule.intentData,
        isActive: capsule.isActive,
        executedAt: capsule.executedAt,
        isDelegated: accountInfo.owner.equals(delegationProgramId),
      }
    } catch (error) {
      debugWarn(`[dashboard] failed to decode registry capsule for owner ${entry.owner}`, error)
      return null
    }
  })

  return settled.filter(Boolean) as Array<{
    capsuleAddress: string
    owner: string
    inactivityPeriod: number
    lastActivity: number
    intentData: Uint8Array
    isActive: boolean
    executedAt: number | null
    isDelegated: boolean
  }>
}

async function fetchCapsulesByProgramScan(connection: Connection, programId: PublicKey) {
  const fetchWithTimeout = (conn: Connection, timeout = 15_000) =>
    Promise.race([
      conn.getProgramAccounts(programId, { commitment: 'confirmed' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('RPC request timed out')), timeout)),
    ])

  let accounts: ReadonlyArray<any> = []
  try {
    accounts = await fetchWithTimeout(connection)
  } catch (error) {
    debugWarn('[dashboard] primary RPC failed, retrying on fallback Solana connection', error)
    const fallbackConnection = getSolanaFallbackConnection()
    accounts = await fetchWithTimeout(fallbackConnection)
  }

  const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
  const decodedCapsules = accounts
    .map((account: any) => {
      try {
        const decoded = decodeCapsuleAccount(account.account.data)
        if (!decoded) return null
        return {
          capsuleAddress: account.pubkey.toBase58(),
          owner: decoded.owner.toBase58(),
          inactivityPeriod: decoded.inactivityPeriod,
          lastActivity: decoded.lastActivity,
          intentData: decoded.intentData,
          isActive: decoded.isActive,
          executedAt: decoded.executedAt,
          isDelegated: account.account.owner.equals(delegationProgramId),
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
      intentData: Uint8Array
      isActive: boolean
      executedAt: number | null
      isDelegated: boolean
    }>

  await Promise.allSettled(decodedCapsules.map((capsule) => registerCapsuleOwner(capsule.owner)))
  return decodedCapsules
}

const toTxRecordFromRpc = (info: any, tx: any): TxRecord => ({
  signature: info.signature,
  blockTime: info.blockTime || null,
  err: info.err || tx?.meta?.err || null,
  logs: tx?.meta?.logMessages || [],
  message: tx?.transaction?.message || null,
  meta: tx?.meta || null,
})

function emptyHistoryMetrics(): DashboardHistoryMetrics {
  return {
    eventRows: [],
    capsuleEventsByCapsule: {},
    allTimeCreated: 0,
    totalProofsSubmitted: 0,
    verifiedProofs: 0,
    totalValueSecuredLamports: 0,
    totalValueExecutedLamports: 0,
  }
}

function sumSecuredLamportsFromEventRows(eventRows: DashboardCapsuleRow[]): number {
  return eventRows.reduce((sum, row) => {
    if (row.status !== 'Created') return sum
    const match = row.events[0]?.logs.find((log) => /Locked \d+ lamports in vault/i.test(log))
    if (!match) return sum
    const amount = match.match(/Locked (\d+) lamports in vault/i)?.[1]
    return sum + Number(amount || 0)
  }, 0)
}

function sumExecutedLamportsFromCapsuleEvents(
  capsuleEventsByCapsule: Record<string, DashboardCapsuleEvent[]>
): number {
  return Object.values(capsuleEventsByCapsule).reduce((outerSum, events) => {
    const innerSum = events.reduce((sum, event) => {
      const eventTransfers = event.logs.reduce((logSum, log) => {
        const amount = log.match(/Transferred (\d+) to beneficiary/i)?.[1]
        return logSum + Number(amount || 0)
      }, 0)
      return sum + eventTransfers
    }, 0)
    return outerSum + innerSum
  }, 0)
}

function normalizeHistoryIndex(index: DashboardHistoryIndex): DashboardHistoryIndex {
  const eventRows = Array.isArray(index.eventRows) ? index.eventRows : []
  const capsuleEventsByCapsule =
    index.capsuleEventsByCapsule && typeof index.capsuleEventsByCapsule === 'object'
      ? index.capsuleEventsByCapsule
      : {}

  const allTimeCreated =
    typeof index.allTimeCreated === 'number' ? index.allTimeCreated : eventRows.filter((row) => row.status === 'Created').length
  const totalProofsSubmitted =
    typeof index.totalProofsSubmitted === 'number' ? index.totalProofsSubmitted : 0
  const verifiedProofs =
    typeof index.verifiedProofs === 'number' ? index.verifiedProofs : 0
  const totalValueSecuredLamports =
    typeof index.totalValueSecuredLamports === 'number'
      ? index.totalValueSecuredLamports
      : sumSecuredLamportsFromEventRows(eventRows)
  const totalValueExecutedLamports =
    typeof index.totalValueExecutedLamports === 'number'
      ? index.totalValueExecutedLamports
      : sumExecutedLamportsFromCapsuleEvents(capsuleEventsByCapsule)

  return {
    ...index,
    eventRows,
    capsuleEventsByCapsule,
    allTimeCreated,
    totalProofsSubmitted,
    verifiedProofs,
    totalValueSecuredLamports,
    totalValueExecutedLamports,
  }
}

function extractDashboardHistoryMetrics(transactions: TxRecord[], programId: PublicKey): DashboardHistoryMetrics {
  if (!transactions.length) return emptyHistoryMetrics()

  const capsuleEvents = new Map<string, DashboardCapsuleEvent[]>()
  const eventRows: DashboardCapsuleRow[] = []
  let allTimeCreated = 0
  let totalProofsSubmitted = 0
  let verifiedProofs = 0
  let totalValueSecuredLamports = 0
  let totalValueExecutedLamports = 0

  const dedupedTransactions = new Map<string, TxRecord>()
  transactions.forEach((record) => {
    if (record.signature) dedupedTransactions.set(record.signature, record)
  })

  Array.from(dedupedTransactions.values()).forEach((record) => {
    const logs = record.logs || []
    const instruction = detectInstruction(logs)
    if (instruction === 'create_capsule' || instruction === 'recreate_capsule') {
      allTimeCreated += 1
      logs.forEach((log) => {
        const amount = log.match(/Locked (\d+) lamports in vault/i)?.[1]
        totalValueSecuredLamports += Number(amount || 0)
      })
    }
    if (instruction === 'execute_intent') {
      totalProofsSubmitted += 1
      if (!record.err) verifiedProofs += 1
    }
    logs.forEach((log) => {
      const amount = log.match(/Transferred (\d+) to beneficiary/i)?.[1]
      totalValueExecutedLamports += Number(amount || 0)
    })

    const message = record.message
    if (!message) return
    const accountKeys = getAccountKeysFromMessage(message)
    const instructions = getInstructionList(message)
    const programIdStr = programId.toBase58()

    instructions.forEach((ix: any, index: number) => {
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
      const event: DashboardCapsuleEvent = {
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

      if (['create_capsule', 'recreate_capsule', 'distribute_assets'].includes(instruction)) {
        eventRows.push({
          id: `event:${record.signature}:${index}`,
          kind: 'event' as const,
          capsuleAddress: capsuleKey,
          owner: ownerKey,
          status: statusFromInstruction(instruction),
          inactivitySeconds: null,
          lastActivityMs: record.blockTime ? record.blockTime * 1000 : null,
          executedAtMs: instruction === 'distribute_assets' && record.blockTime ? record.blockTime * 1000 : null,
          payloadSize: null,
          signature: record.signature,
          isActive: null,
          isDelegated: false,
          events: [event],
          tokenDelta,
          solDelta,
          proofBytes,
          assetSymbol: null,
          assetLabel: null,
          totalAmount: null,
        })
      }
    })
  })

  const capsuleEventsByCapsule = Object.fromEntries(
    Array.from(capsuleEvents.entries()).map(([capsuleKey, events]) => [
      capsuleKey,
      events.sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0)),
    ])
  )

  return {
    eventRows: eventRows.sort((a, b) => {
      const aTime = a.lastActivityMs || a.executedAtMs || 0
      const bTime = b.lastActivityMs || b.executedAtMs || 0
      return bTime - aTime
    }),
    capsuleEventsByCapsule,
    allTimeCreated,
    totalProofsSubmitted,
    verifiedProofs,
    totalValueSecuredLamports,
    totalValueExecutedLamports,
  }
}

function mergeHistoryIndexes(
  existing: DashboardHistoryIndex,
  incoming: DashboardHistoryMetrics,
  latestSignature: string | null,
  scanComplete: boolean
): DashboardHistoryIndex {
  const eventRowMap = new Map<string, DashboardCapsuleRow>()
  ;[...existing.eventRows, ...incoming.eventRows].forEach((row) => {
    eventRowMap.set(row.id, row)
  })

  const capsuleEventMap = new Map<string, DashboardCapsuleEvent[]>()
  const allCapsuleKeys = new Set([
    ...Object.keys(existing.capsuleEventsByCapsule || {}),
    ...Object.keys(incoming.capsuleEventsByCapsule || {}),
  ])

  allCapsuleKeys.forEach((capsuleKey) => {
    const merged = [
      ...(existing.capsuleEventsByCapsule[capsuleKey] || []),
      ...(incoming.capsuleEventsByCapsule[capsuleKey] || []),
    ]
    const deduped = new Map<string, DashboardCapsuleEvent>()
    merged.forEach((event) => {
      deduped.set(`${event.signature}:${event.label}:${event.capsuleAddress}`, event)
    })
    capsuleEventMap.set(
      capsuleKey,
      Array.from(deduped.values()).sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0))
    )
  })

  const mergedEventRows = Array.from(eventRowMap.values()).sort((a, b) => {
    const aTime = a.lastActivityMs || a.executedAtMs || 0
    const bTime = b.lastActivityMs || b.executedAtMs || 0
    return bTime - aTime
  })

  const allTimeCreated = existing.allTimeCreated + incoming.allTimeCreated
  const totalProofsSubmitted = existing.totalProofsSubmitted + incoming.totalProofsSubmitted
  const verifiedProofs = existing.verifiedProofs + incoming.verifiedProofs
  const totalValueSecuredLamports = existing.totalValueSecuredLamports + incoming.totalValueSecuredLamports
  const totalValueExecutedLamports = existing.totalValueExecutedLamports + incoming.totalValueExecutedLamports

  return {
    v: DASHBOARD_HISTORY_SCHEMA_VERSION,
    programId: existing.programId,
    latestSignature: latestSignature || existing.latestSignature,
    oldestSignature: existing.oldestSignature,
    scanComplete,
    eventRows: mergedEventRows,
    capsuleEventsByCapsule: Object.fromEntries(capsuleEventMap.entries()),
    allTimeCreated,
    totalProofsSubmitted,
    verifiedProofs,
    totalValueSecuredLamports,
    totalValueExecutedLamports,
    updatedAt: Date.now(),
  }
}

async function getDashboardHistoryIndex(
  connection: Connection,
  programId: PublicKey,
  forceRefresh: boolean
): Promise<DashboardHistoryIndex> {
  const programIdStr = programId.toBase58()
  const existing = await loadDashboardHistoryIndex(programIdStr)
  const normalizedExisting = existing ? normalizeHistoryIndex(existing) : null

  if (normalizedExisting && !forceRefresh && normalizedExisting.scanComplete) {
    return normalizedExisting
  }

  if (normalizedExisting?.latestSignature) {
    const newestChunk = await fetchProgramHistoryTransactions(
      connection,
      programId,
      normalizedExisting.latestSignature,
      PROGRAM_SIGNATURE_INCREMENTAL_PAGES
    )
    let merged = normalizedExisting

    if (newestChunk.transactions.length) {
      merged = mergeHistoryIndexes(
        merged,
        extractDashboardHistoryMetrics(newestChunk.transactions, programId),
        newestChunk.transactions[0]?.signature || merged.latestSignature,
        merged.scanComplete && newestChunk.exhausted
      )
    }

    if (!merged.scanComplete && merged.oldestSignature) {
      const olderChunk = await fetchProgramHistoryTransactions(
        connection,
        programId,
        undefined,
        PROGRAM_SIGNATURE_BACKFILL_PAGES,
        merged.oldestSignature
      )

      if (olderChunk.transactions.length) {
        const olderMetrics = extractDashboardHistoryMetrics(olderChunk.transactions, programId)
        const olderMerged = mergeHistoryIndexes(
          merged,
          olderMetrics,
          merged.latestSignature,
          olderChunk.exhausted
        )
        olderMerged.oldestSignature =
          olderChunk.transactions[olderChunk.transactions.length - 1]?.signature || merged.oldestSignature
        merged = olderMerged
      } else if (olderChunk.exhausted) {
        merged = {
          ...merged,
          scanComplete: true,
          updatedAt: Date.now(),
        }
      }
    }

    await saveDashboardHistoryIndex(merged)
    if (!forceRefresh && merged.scanComplete) {
      return merged
    }
    return merged
  }

  const { transactions, exhausted } = await fetchProgramHistoryTransactions(connection, programId)
  const metrics = extractDashboardHistoryMetrics(transactions, programId)
  const built: DashboardHistoryIndex = {
    v: DASHBOARD_HISTORY_SCHEMA_VERSION,
    programId: programIdStr,
    latestSignature: transactions[0]?.signature || null,
    oldestSignature: transactions[transactions.length - 1]?.signature || null,
    scanComplete: exhausted,
    eventRows: metrics.eventRows,
    capsuleEventsByCapsule: metrics.capsuleEventsByCapsule,
    allTimeCreated: metrics.allTimeCreated,
    totalProofsSubmitted: metrics.totalProofsSubmitted,
    verifiedProofs: metrics.verifiedProofs,
    totalValueSecuredLamports: metrics.totalValueSecuredLamports,
    totalValueExecutedLamports: metrics.totalValueExecutedLamports,
    updatedAt: Date.now(),
  }
  await saveDashboardHistoryIndex(built)
  return built
}

async function buildDashboardSnapshot(
  includeHistory: boolean,
  fullScan: boolean,
  forceRefresh: boolean
): Promise<DashboardSnapshot> {
  const connection = getSolanaConnection()
  const programId = getProgramId()

  let decodedCapsules: Array<{
    capsuleAddress: string
    owner: string
    inactivityPeriod: number
    lastActivity: number
    intentData: Uint8Array
    isActive: boolean
    executedAt: number | null
    isDelegated: boolean
  }> = []
  try {
    decodedCapsules = await fetchCapsulesByProgramScan(connection, programId)
    debugLog(`[dashboard] loaded ${decodedCapsules.length} capsules from program scan`)
  } catch (error) {
    debugWarn('[dashboard] program scan failed, falling back to registry batch fetch', error)
    decodedCapsules = await fetchCapsulesFromRegistry()
    if (decodedCapsules.length > 0) {
      debugLog(`[dashboard] loaded ${decodedCapsules.length} capsules from registry fallback`)
    }
  }

  let historyIndex: DashboardHistoryIndex | null = null
  if (includeHistory) {
    try {
      historyIndex = await getDashboardHistoryIndex(connection, programId, forceRefresh)
    } catch (error) {
      debugWarn('[dashboard] failed to refresh dashboard history index, falling back to persisted history', error)
      historyIndex = await loadDashboardHistoryIndex(programId.toBase58())
    }
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  let vaultRentExemptLamports = 0
  try {
    vaultRentExemptLamports = await connection.getMinimumBalanceForRentExemption(9)
  } catch (error) {
    debugWarn('[dashboard] primary RPC failed to fetch rent exemption, retrying on fallback RPC', error)
    vaultRentExemptLamports = await getSolanaFallbackConnection().getMinimumBalanceForRentExemption(9)
  }
  const capsuleRows: DashboardCapsuleRow[] = decodedCapsules
    .map((capsule) => {
      const executedAtMs = capsule.executedAt ? capsule.executedAt * 1000 : null
      const lastActivityMs = capsule.lastActivity * 1000
      const isExpired = capsule.executedAt === null && capsule.lastActivity + capsule.inactivityPeriod < nowSeconds
      const status = capsule.executedAt ? 'Executed' : isExpired ? 'Expired' : 'Active'
      const events = (historyIndex?.capsuleEventsByCapsule[capsule.capsuleAddress] || []).sort(
        (a, b) => (b.blockTime || 0) - (a.blockTime || 0)
      )
      const parsedIntent = parseIntentPayload(capsule.intentData)
      const asset = inferAssetConfig(parsedIntent, null)
      const totalAmount =
        parsedIntent && 'totalAmount' in parsedIntent && typeof parsedIntent.totalAmount === 'string'
          ? parsedIntent.totalAmount
          : null

      return {
        id: capsule.capsuleAddress,
        kind: 'capsule' as const,
        capsuleAddress: capsule.capsuleAddress,
        owner: capsule.owner,
        status,
        inactivitySeconds: capsule.inactivityPeriod,
        lastActivityMs,
        executedAtMs,
        payloadSize: capsule.intentData.length,
        signature: events[0]?.signature || null,
        isActive: capsule.isActive,
        isDelegated: capsule.isDelegated,
        events,
        tokenDelta: null,
        solDelta: null,
        proofBytes: null,
        assetSymbol: asset.symbol,
        assetLabel: asset.label,
        totalAmount,
      }
    })
    .filter((row) => !(row.status === 'Active' && row.isActive === false))

  const activeCapsules = capsuleRows.filter((capsule) => capsule.status === 'Active' && capsule.owner)
  const activeVaultPdas = activeCapsules.map((capsule) => getCapsuleVaultPDA(new PublicKey(capsule.owner!))[0])
  const activeVaultInfos = await getMultipleAccountsInfoBatched(connection, activeVaultPdas)
  const activeVaultBalances = activeVaultInfos.map((accountInfo) =>
    Math.max(0, (accountInfo?.lamports || 0) - vaultRentExemptLamports)
  )
  const activeValueLockedLamports = activeVaultBalances.reduce((sum, value) => sum + value, 0)
  const activeAssetTotals = activeCapsules.reduce<Partial<Record<SupportedAssetSymbol, number>>>((totals, capsule) => {
    if (!capsule.assetSymbol || !capsule.totalAmount) return totals
    const amount = Number.parseFloat(capsule.totalAmount)
    if (!Number.isFinite(amount)) return totals
    totals[capsule.assetSymbol] = (totals[capsule.assetSymbol] || 0) + amount
    return totals
  }, {})

  const summary: DashboardSummary = {
    total: includeHistory && (historyIndex?.allTimeCreated || 0) > 0 ? historyIndex!.allTimeCreated : capsuleRows.length,
    allTimeCreated: includeHistory ? historyIndex?.allTimeCreated ?? 0 : null,
    active: capsuleRows.filter((capsule) => capsule.status === 'Active').length,
    executed: capsuleRows.filter((capsule) => capsule.status === 'Executed').length,
    expired: capsuleRows.filter((capsule) => capsule.status === 'Expired').length,
    proofs: historyIndex?.verifiedProofs ?? 0,
    successRate:
      (historyIndex?.totalProofsSubmitted || 0) > 0
        ? ((historyIndex?.verifiedProofs || 0) / (historyIndex?.totalProofsSubmitted || 1)) * 100
        : 0,
    totalValueSecuredLamports: historyIndex?.totalValueSecuredLamports ?? 0,
    totalValueExecutedLamports: historyIndex?.totalValueExecutedLamports ?? 0,
    activeValueLockedLamports,
    activeAssetTotals,
  }

  const snapshot = {
    capsules: [...capsuleRows, ...(historyIndex?.eventRows || [])].sort((a, b) => {
      const aTime = a.lastActivityMs || a.executedAtMs || 0
      const bTime = b.lastActivityMs || b.executedAtMs || 0
      return bTime - aTime
    }),
    summary,
    timestamp: Date.now(),
    historyLoaded: includeHistory,
    complete: historyIndex?.scanComplete ?? true,
  }

  debugLog(`[dashboard] built snapshot with ${snapshot.capsules.length} rows`)
  return snapshot
}

export async function getDashboardSnapshot(forceRefresh = false, includeHistory = true, fullScan = false): Promise<DashboardSnapshot> {
  const cacheKey = `${includeHistory ? 'full' : 'summary'}:${fullScan ? 'scan' : 'fast'}`
  const now = Date.now()
  const cached = dashboardCache.get(cacheKey)
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.snapshot
  }

  const persisted = await loadPersistedDashboardSnapshot(cacheKey)
  if (persisted?.value) {
    primeDashboardSnapshotCache(cacheKey, persisted.value)
    const age = now - persisted.updatedAt

    if (!forceRefresh && age <= DASHBOARD_INDEX_FRESH_MS) {
      return persisted.value
    }

    triggerDashboardSnapshotRefresh(cacheKey, includeHistory, fullScan)

    if (forceRefresh || age <= DASHBOARD_INDEX_MAX_STALE_MS) {
      return persisted.value
    }

    return await refreshDashboardSnapshot(cacheKey, includeHistory, fullScan)
  }

  const inFlight = inFlightSnapshots.get(cacheKey)
  if (inFlight) {
    return inFlight
  }

  return await refreshDashboardSnapshot(cacheKey, includeHistory, fullScan)
}

function rowMatchesFilter(row: DashboardCapsuleRow, filter: CapsuleListFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'live') return row.kind === 'capsule'
  if (filter === 'created') return row.kind === 'event' && row.status === 'Created'
  if (filter === 'executed') return row.kind === 'event' && row.status === 'Executed'
  if (filter === 'active') return row.kind === 'capsule' && row.status === 'Active'
  if (filter === 'expired') return row.kind === 'capsule' && row.status === 'Expired'
  return true
}

function rowMatchesQuery(row: DashboardCapsuleRow, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  return (
    row.capsuleAddress.toLowerCase().includes(normalized) ||
    row.owner?.toLowerCase().includes(normalized) ||
    row.signature?.toLowerCase().includes(normalized) ||
    false
  )
}

function sortRows(rows: DashboardCapsuleRow[], sort: CapsuleListSort): DashboardCapsuleRow[] {
  return [...rows].sort((a, b) => {
    const aTime = a.lastActivityMs || a.executedAtMs || 0
    const bTime = b.lastActivityMs || b.executedAtMs || 0
    return sort === 'oldest' ? aTime - bTime : bTime - aTime
  })
}

function toListItem(row: DashboardCapsuleRow): CapsuleListItem {
  return {
    ...row,
    // Privacy: list payloads exclude full event/log blobs and only keep safe metadata needed to render cards.
    eventCount: row.events.length,
  }
}

export async function getCapsulesSummary(forceRefresh = false): Promise<CapsuleSummaryResponse> {
  const snapshot = await getDashboardSnapshot(forceRefresh, true, false)
  return {
    summary: snapshot.summary,
    timestamp: snapshot.timestamp,
    complete: snapshot.complete,
  }
}

export async function getCapsulesListPage(options?: {
  page?: number
  limit?: number
  filter?: CapsuleListFilter
  query?: string
  sort?: CapsuleListSort
  forceRefresh?: boolean
}): Promise<CapsuleListResponse> {
  const page = Math.max(1, Number(options?.page || 1))
  const limit = Math.min(100, Math.max(1, Number(options?.limit || 20)))
  const filter = options?.filter || 'all'
  const query = options?.query || ''
  const sort = options?.sort || 'newest'
  const forceRefresh = Boolean(options?.forceRefresh)

  const snapshot = await getDashboardSnapshot(forceRefresh, true, false)
  const filtered = sortRows(
    snapshot.capsules.filter((row) => rowMatchesFilter(row, filter) && rowMatchesQuery(row, query)),
    sort
  )

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * limit
  const items = filtered.slice(start, start + limit).map(toListItem)

  return {
    items,
    page: safePage,
    limit,
    total,
    totalPages,
    timestamp: snapshot.timestamp,
    complete: snapshot.complete,
  }
}

export async function getCapsuleDetail(id: string, forceRefresh = false): Promise<DashboardCapsuleRow | null> {
  const snapshot = await getDashboardSnapshot(forceRefresh, true, false)
  return snapshot.capsules.find((row) => row.id === id) || null
}

export async function getFeeConfigStatus(forceRefresh = false): Promise<boolean> {
  return getCachedResponse(
    'capsules:fee-config',
    async () => {
      const cacheKey = 'fee-config'
      const cached = feeConfigCache.get(cacheKey)
      if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
        return cached.value
      }

      const connection = getSolanaConnection()
      const { getFeeConfigPDA } = await import('@/lib/program')
      const [feeConfigPda] = getFeeConfigPDA()
      const account = await connection.getAccountInfo(feeConfigPda, 'confirmed')
      const value = account != null
      feeConfigCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
      })
      return value
    },
    forceRefresh
  )
}

export function ensureDashboardPrewarmScheduler(): void {
  if (!shouldEnableDashboardPrewarm()) return
  if (typeof globalThis.__heresDashboardPrewarmStarted !== 'undefined' && globalThis.__heresDashboardPrewarmStarted) {
    return
  }

  globalThis.__heresDashboardPrewarmStarted = true

  // Warm once immediately so the first real visitor is less likely to pay the cold-start cost.
  void prewarmDashboardResponses(false).catch(() => {})

  globalThis.__heresDashboardPrewarmTimer = setInterval(() => {
    void prewarmDashboardResponses(false).catch(() => {})
  }, DASHBOARD_PREWARM_INTERVAL_MS)

  globalThis.__heresDashboardPrewarmTimer?.unref?.()
}

export async function triggerDashboardPrewarm(forceRefresh = true): Promise<void> {
  await prewarmDashboardResponses(forceRefresh)
}

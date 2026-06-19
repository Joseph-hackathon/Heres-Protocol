import { Connection, PublicKey } from '@solana/web3.js'
import { BorshAccountsCoder } from '@coral-xyz/anchor'
import legacyIdl26pdf from '../idl/legacy/heres_program_26pdf.json'
import type { DashboardSummary } from './dashboard'

// Earlier high-activity deploys whose accounts use a different on-chain layout than
// the current lean program. The old IntentCapsule carried intent_data / mint /
// ccip_sent_bitmap (a CCIP cross-chain design) plus standalone CapsuleVault
// accounts, so the current coder cannot decode them (same account name, different
// fields). We decode each legacy program with its own era IDL so the public
// dashboard + landing hero can surface the protocol's full history. READ-ONLY:
// never used for signing, delegation, or any write path.
const LEGACY_IDLS: Record<string, unknown> = {
  '26pDfWXnq9nm1Y5J6siwQsVfHXKxKo5vKvRMVCpqXms6': legacyIdl26pdf,
}

export function isLegacyStatsProgram(programId: PublicKey): boolean {
  return programId.toBase58() in LEGACY_IDLS
}

type CacheEntry = { summary: DashboardSummary; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const TTL_MS = 5 * 60 * 1000

const EMPTY_SUMMARY: DashboardSummary = {
  total: 0,
  allTimeCreated: 0,
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

// Anchor i64/u64 fields come back as BN; Option fields as null. Normalize to number.
const toNum = (value: unknown): number => {
  if (value == null) return 0
  if (typeof value === 'number') return value
  if (typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber()
  }
  return Number((value as { toString: () => string }).toString())
}

/**
 * Aggregate stats for a legacy program, decoded with its era IDL. Counts capsules
 * (total / active / settled) and sums currently-locked SOL across CapsuleVault
 * accounts (balance minus rent, so already-executed/drained vaults contribute ~0).
 * Cached in-process for a few minutes; forceRefresh bypasses the cache.
 */
export async function buildLegacyStatsSummary(
  connection: Connection,
  programId: PublicKey,
  forceRefresh = false
): Promise<DashboardSummary> {
  const key = programId.toBase58()
  const idl = LEGACY_IDLS[key]
  if (!idl) return EMPTY_SUMMARY

  const now = Date.now()
  if (!forceRefresh) {
    const hit = cache.get(key)
    if (hit && hit.expiresAt > now) return hit.summary
  }

  const coder = new BorshAccountsCoder(idl as never)
  const accounts = await connection.getProgramAccounts(programId, { commitment: 'confirmed' })

  let total = 0
  let active = 0
  let executed = 0
  const vaultAccounts: Array<{ lamports: number; size: number }> = []

  for (const { account } of accounts) {
    const data = account.data
    let decodedCapsule = false
    try {
      const capsule = coder.decode('IntentCapsule', data) as {
        is_active?: boolean
        executed_at?: unknown
      }
      total += 1
      const isExecuted = capsule.executed_at != null && toNum(capsule.executed_at) !== 0
      if (isExecuted) executed += 1
      else if (capsule.is_active) active += 1
      decodedCapsule = true
    } catch {
      // not an IntentCapsule; fall through to the vault check
    }
    if (decodedCapsule) continue
    try {
      coder.decode('CapsuleVault', data)
      vaultAccounts.push({ lamports: account.lamports, size: data.length })
    } catch {
      // neither capsule nor vault (FeeConfig, etc.) -- ignore
    }
  }

  // Rent-exempt minimum is fixed per account size; fetch once per distinct size.
  const rentBySize = new Map<number, number>()
  let lockedLamports = 0
  for (const vault of vaultAccounts) {
    let rent = rentBySize.get(vault.size)
    if (rent == null) {
      try {
        rent = await connection.getMinimumBalanceForRentExemption(vault.size)
      } catch {
        rent = 0
      }
      rentBySize.set(vault.size, rent)
    }
    lockedLamports += Math.max(0, vault.lamports - rent)
  }

  const summary: DashboardSummary = {
    total,
    allTimeCreated: total,
    active,
    executed,
    expired: 0,
    proofs: 0,
    successRate: 0,
    // Value Secured = currently locked in vaults (chosen over lifetime cumulative).
    totalValueSecuredLamports: lockedLamports,
    totalValueExecutedLamports: 0,
    activeValueLockedLamports: lockedLamports,
    activeAssetTotals: {},
  }

  cache.set(key, { summary, expiresAt: now + TTL_MS })
  return summary
}

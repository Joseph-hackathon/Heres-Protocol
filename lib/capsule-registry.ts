/**
 * Capsule owner registry backed by Upstash Redis.
 * Tracks wallet addresses that have created capsules so the crank can
 * look up their PDAs without getProgramAccounts (which hangs on devnet).
 *
 * M2 scale layer: alongside the flat owner set, the registry keeps a due-time
 * index (score = last_activity + inactivity_period, in seconds). The crank reads
 * only the owners whose due-time has passed (getDueOwners), so an armed capsule
 * that is nowhere near firing is never fetched. The flat set is retained so the
 * crank can fall back to a full scan if the index read fails, and so the
 * dashboard/mobile readers keep working unchanged.
 *
 * Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars.
 * Falls back to file-based storage in local dev if env vars are missing.
 */
import { Redis } from '@upstash/redis'
import { debugLog } from '@/lib/log'
import { isPostgresConfigured, pgQuery } from '@/lib/postgres'
import { getDataDir, getDataFilePath } from '@/lib/runtime-paths'

const REDIS_KEY = 'capsule-owners'
const REDIS_DUE_KEY = 'capsule-owners-due'

// Sentinel score for a freshly registered owner whose true due-time is not yet
// known. 0 means "always due", so the next crank tick fetches it once, decodes
// its real due-time, and re-scores it (self-heal). A capsule that is not yet
// elapsed is then excluded from every subsequent tick until it is due.
const DUE_UNKNOWN = 0

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

// ---------------------------------------------------------------------------
// File-based fallback for local dev (no Redis configured)
// Stored as a map { owner: dueAtSeconds | null }. Legacy files written as a
// plain string[] are read transparently (each owner -> DUE_UNKNOWN).
// ---------------------------------------------------------------------------
type DueMap = Record<string, number | null>

function loadLocalMap(): DueMap {
  try {
    const fs = require('fs')
    const p = getDataFilePath('capsule-registry.json')
    if (!fs.existsSync(p)) return {}
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (Array.isArray(parsed)) {
      const map: DueMap = {}
      for (const owner of parsed) map[owner] = DUE_UNKNOWN
      return map
    }
    return parsed && typeof parsed === 'object' ? (parsed as DueMap) : {}
  } catch {
    return {}
  }
}

function saveLocalMap(map: DueMap) {
  try {
    const fs = require('fs')
    const dir = getDataDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const p = getDataFilePath('capsule-registry.json')
    const tmp = `${p}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(map))
    fs.renameSync(tmp, p)
  } catch (err) {
    console.warn('[capsule-registry] local save failed:', err)
  }
}

function shouldUseLocalFallback(): boolean {
  return !getRedis() && !isPostgresConfigured()
}

// ---------------------------------------------------------------------------
// Public API (async — callers must await)
// ---------------------------------------------------------------------------

/** Register a capsule owner (idempotent). Seeds the due index at DUE_UNKNOWN. */
export async function registerCapsuleOwner(ownerPubkey: string): Promise<void> {
  const redis = getRedis()
  if (redis) {
    const added = await redis.sadd(REDIS_KEY, ownerPubkey)
    // nx: don't reset an existing score (e.g. a re-registration after self-heal).
    await redis.zadd(REDIS_DUE_KEY, { nx: true }, { score: DUE_UNKNOWN, member: ownerPubkey })
    if (added) debugLog(`[capsule-registry] Registered owner: ${ownerPubkey}`)
    return
  }

  if (isPostgresConfigured()) {
    await pgQuery(
      `INSERT INTO capsule_owner_registry (owner_address, registered_at)
       VALUES ($1, NOW())
       ON CONFLICT (owner_address) DO NOTHING`,
      [ownerPubkey]
    )
    debugLog(`[capsule-registry] Registered owner (postgres): ${ownerPubkey}`)
    return
  }

  if (shouldUseLocalFallback()) {
    const map = loadLocalMap()
    if (!(ownerPubkey in map)) {
      map[ownerPubkey] = DUE_UNKNOWN
      saveLocalMap(map)
      debugLog(`[capsule-registry] Registered owner (local): ${ownerPubkey}`)
    }
    return
  }
}

/**
 * Set the due-time for an owner (seconds since epoch). Pushing a cold capsule's
 * score into the future excludes it from getDueOwners until it is actually due;
 * this is how the crank self-heals a seeded/stale entry. Also ensures the owner
 * is present in the flat set so the full-scan fallback stays complete.
 */
export async function setCapsuleDue(ownerPubkey: string, dueAtSeconds: number): Promise<void> {
  const due = Math.floor(dueAtSeconds)
  const redis = getRedis()
  if (redis) {
    await redis.sadd(REDIS_KEY, ownerPubkey)
    await redis.zadd(REDIS_DUE_KEY, { score: due, member: ownerPubkey })
    return
  }

  if (isPostgresConfigured()) {
    await pgQuery(
      `INSERT INTO capsule_owner_registry (owner_address, registered_at, due_at)
       VALUES ($1, NOW(), $2)
       ON CONFLICT (owner_address) DO UPDATE SET due_at = EXCLUDED.due_at`,
      [ownerPubkey, due]
    )
    return
  }

  if (shouldUseLocalFallback()) {
    const map = loadLocalMap()
    map[ownerPubkey] = due
    saveLocalMap(map)
    return
  }
}

/**
 * Owners whose due-time has passed (<= nowSeconds). This is the hot path the
 * crank reads each tick: only capsules that might need action are returned.
 * Throws on a hard backend failure so the caller can fall back to a full scan.
 */
export async function getDueOwners(nowSeconds: number): Promise<string[]> {
  const now = Math.floor(nowSeconds)
  const redis = getRedis()
  if (redis) {
    // One-time / drift reconcile: seed any flat-set owners missing from the ZSET
    // (e.g. capsules registered before the due index existed) at DUE_UNKNOWN.
    const [zc, sc] = await Promise.all([redis.zcard(REDIS_DUE_KEY), redis.scard(REDIS_KEY)])
    if (zc !== sc) {
      const [members, scored] = await Promise.all([
        redis.smembers(REDIS_KEY),
        redis.zrange<string[]>(REDIS_DUE_KEY, 0, '+inf', { byScore: true }),
      ])
      const known = new Set(scored)
      const missing = members.filter((m) => !known.has(m))
      for (const m of missing) {
        await redis.zadd(REDIS_DUE_KEY, { nx: true }, { score: DUE_UNKNOWN, member: m })
      }
    }
    return await redis.zrange<string[]>(REDIS_DUE_KEY, 0, now, { byScore: true })
  }

  if (isPostgresConfigured()) {
    const result = await pgQuery<{ owner_address: string }>(
      `SELECT owner_address
       FROM capsule_owner_registry
       WHERE due_at IS NULL OR due_at <= $1
       ORDER BY due_at ASC NULLS FIRST`,
      [now]
    )
    return result.rows.map((row) => row.owner_address)
  }

  const map = loadLocalMap()
  return Object.keys(map).filter((owner) => {
    const due = map[owner]
    return due == null || due <= now
  })
}

/** Get all registered capsule owners (full set; used by dashboard + fallback). */
export async function getRegisteredOwners(): Promise<string[]> {
  const redis = getRedis()
  if (redis) return await redis.smembers(REDIS_KEY)

  if (isPostgresConfigured()) {
    const result = await pgQuery<{ owner_address: string }>(
      `SELECT owner_address
       FROM capsule_owner_registry
       ORDER BY registered_at DESC`
    )
    return result.rows.map((row) => row.owner_address)
  }

  return Object.keys(loadLocalMap())
}

/** Remove a capsule owner (after capsule is fully distributed) from set + index. */
export async function unregisterCapsuleOwner(ownerPubkey: string): Promise<void> {
  const redis = getRedis()
  if (redis) {
    await redis.srem(REDIS_KEY, ownerPubkey)
    await redis.zrem(REDIS_DUE_KEY, ownerPubkey)
    return
  }

  if (isPostgresConfigured()) {
    await pgQuery(
      'DELETE FROM capsule_owner_registry WHERE owner_address = $1',
      [ownerPubkey]
    )
    return
  }

  if (shouldUseLocalFallback()) {
    const map = loadLocalMap()
    delete map[ownerPubkey]
    saveLocalMap(map)
    return
  }
}

/**
 * Capsule owner registry backed by Upstash Redis.
 * Tracks wallet addresses that have created capsules so the crank can
 * look up their PDAs without getProgramAccounts (which hangs on devnet).
 *
 * Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars.
 * Falls back to file-based storage in local dev if env vars are missing.
 */
import { Redis } from '@upstash/redis'
import { debugLog } from '@/lib/log'
import { isPostgresConfigured, pgQuery } from '@/lib/postgres'
import { getDataDir, getDataFilePath } from '@/lib/runtime-paths'

const REDIS_KEY = 'capsule-owners'

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

// ---------------------------------------------------------------------------
// File-based fallback for local dev (no Redis configured)
// ---------------------------------------------------------------------------
function loadLocal(): string[] {
  try {
    const fs = require('fs')
    const p = getDataFilePath('capsule-registry.json')
    if (!fs.existsSync(p)) return []
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return []
  }
}

function saveLocal(owners: string[]) {
  try {
    const fs = require('fs')
    const dir = getDataDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const p = getDataFilePath('capsule-registry.json')
    const tmp = `${p}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(owners))
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

/** Register a capsule owner (idempotent) */
export async function registerCapsuleOwner(ownerPubkey: string): Promise<void> {
  const redis = getRedis()
  if (redis) {
    const added = await redis.sadd(REDIS_KEY, ownerPubkey)
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
    const owners = loadLocal()
    if (!owners.includes(ownerPubkey)) {
      owners.push(ownerPubkey)
      saveLocal(owners)
      debugLog(`[capsule-registry] Registered owner (local): ${ownerPubkey}`)
    }
    return
  }
}

/** Get all registered capsule owners */
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

  return loadLocal()
}

/** Remove a capsule owner (after capsule is fully distributed) */
export async function unregisterCapsuleOwner(ownerPubkey: string): Promise<void> {
  const redis = getRedis()
  if (redis) {
    await redis.srem(REDIS_KEY, ownerPubkey)
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
    const owners = loadLocal().filter(o => o !== ownerPubkey)
    saveLocal(owners)
    return
  }
}

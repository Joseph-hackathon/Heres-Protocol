import 'server-only'

/**
 * Durable store for the self-hosted intent-delivery engine.
 *
 * Primary backend is Upstash Redis (the same instance that backs the capsule
 * registry + dashboard cache), so registered intents and the delivery ledger
 * survive cold starts and are shared across serverless instances. This replaces
 * the previous flat JSON file at /tmp on Vercel, which was ephemeral and
 * per-lambda - the root cause of unreliable production delivery.
 *
 * When Redis is not configured (local dev) it falls back to the original
 * file-backed maps so the dev loop and build-check keep working unchanged.
 *
 * All functions are async (Redis is async over REST). Callers must await.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import path from 'path'
import { Redis } from '@upstash/redis'
import { getDataFilePath } from '@/lib/runtime-paths'
import {
  IntentDeliveryLedgerRecord,
  IntentReminderDeliveryRecord,
  IntentReminderRecord,
  IntentSecretRecord,
} from '@/lib/intent-delivery/types'

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

const K = {
  secret: (ref: string) => `intent:secret:${ref}`,
  secretsSet: 'intent:secrets',
  secretByOwner: (owner: string) => `intent:secret:owner:${owner}`,
  delivery: (key: string) => `intent:delivery:${key}`,
  deliveryByCapsule: (cap: string) => `intent:delivery:capsule:${cap}`,
  reminder: (id: string) => `intent:reminder:${id}`,
  remindersSet: 'intent:reminders',
  reminderByCapsule: (cap: string) => `intent:reminder:capsule:${cap}`,
  reminderDelivery: (key: string) => `intent:reminderdelivery:${key}`,
  reminderDeliveryByCapsule: (cap: string) => `intent:reminderdelivery:capsule:${cap}`,
  lock: (key: string) => `intent:lock:${key}`,
}

async function redisMany<T>(redis: Redis, keys: string[]): Promise<T[]> {
  if (keys.length === 0) return []
  const values = await redis.mget<T[]>(...keys)
  return (values ?? []).filter((v): v is T => v != null)
}

// ---------------------------------------------------------------------------
// File fallback (local dev only) - original global-cached JSON map approach
// ---------------------------------------------------------------------------

type IntentStoreState = {
  secrets: Map<string, IntentSecretRecord>
  deliveries: Map<string, IntentDeliveryLedgerRecord>
  reminders: Map<string, IntentReminderRecord>
  reminderDeliveries: Map<string, IntentReminderDeliveryRecord>
}

type PersistedIntentStoreState = {
  secrets: IntentSecretRecord[]
  deliveries: IntentDeliveryLedgerRecord[]
  reminders: IntentReminderRecord[]
  reminderDeliveries: IntentReminderDeliveryRecord[]
}

declare global {
  // eslint-disable-next-line no-var
  var __heresIntentStore: IntentStoreState | undefined
}

function emptyState(): IntentStoreState {
  return {
    secrets: new Map(),
    deliveries: new Map(),
    reminders: new Map(),
    reminderDeliveries: new Map(),
  }
}

function getStorePath(): string {
  const configuredPath = process.env.INTENT_STORE_PATH?.trim()
  if (configuredPath) return configuredPath
  return getDataFilePath('cre-store.json')
}

function loadStateFromDisk(): IntentStoreState {
  const storePath = getStorePath()
  if (!existsSync(storePath)) return emptyState()
  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as PersistedIntentStoreState
    const secrets = Array.isArray(parsed.secrets) ? parsed.secrets : []
    const deliveries = Array.isArray(parsed.deliveries) ? parsed.deliveries : []
    const reminders = Array.isArray(parsed.reminders) ? parsed.reminders : []
    const reminderDeliveries = Array.isArray(parsed.reminderDeliveries) ? parsed.reminderDeliveries : []
    return {
      secrets: new Map(secrets.map((e) => [e.secretRef, e])),
      deliveries: new Map(deliveries.map((e) => [e.idempotencyKey, e])),
      reminders: new Map(reminders.map((e) => [e.reminderId, e])),
      reminderDeliveries: new Map(reminderDeliveries.map((e) => [e.idempotencyKey, e])),
    }
  } catch {
    return emptyState()
  }
}

function persistState(state: IntentStoreState): void {
  const storePath = getStorePath()
  mkdirSync(path.dirname(storePath), { recursive: true })
  const data: PersistedIntentStoreState = {
    secrets: Array.from(state.secrets.values()),
    deliveries: Array.from(state.deliveries.values()),
    reminders: Array.from(state.reminders.values()),
    reminderDeliveries: Array.from(state.reminderDeliveries.values()),
  }
  const tmpPath = `${storePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmpPath, storePath)
}

function getState(): IntentStoreState {
  if (!globalThis.__heresIntentStore) {
    globalThis.__heresIntentStore = loadStateFromDisk()
  }
  return globalThis.__heresIntentStore
}

// ---------------------------------------------------------------------------
// Pure merge helpers (shared by both backends)
// ---------------------------------------------------------------------------

function coalesceNonEmpty(nextValue: string | undefined, existingValue: string | undefined): string {
  if (typeof nextValue === 'string' && nextValue.trim().length > 0) return nextValue
  return existingValue ?? ''
}

function buildDeliveryRecord(
  idempotencyKey: string,
  patch: Partial<IntentDeliveryLedgerRecord> & {
    capsuleAddress: string
    executedAt: number
    status: IntentDeliveryLedgerRecord['status']
  },
  existing: IntentDeliveryLedgerRecord | null
): IntentDeliveryLedgerRecord {
  const now = Date.now()
  return {
    idempotencyKey,
    capsuleAddress: patch.capsuleAddress,
    owner: coalesceNonEmpty(patch.owner, existing?.owner),
    executedAt: patch.executedAt,
    recipientEmail: coalesceNonEmpty(patch.recipientEmail, existing?.recipientEmail),
    secretRef: coalesceNonEmpty(patch.secretRef, existing?.secretRef),
    status: patch.status,
    attempts: patch.attempts ?? existing?.attempts ?? 0,
    nextAttemptAt: patch.nextAttemptAt ?? existing?.nextAttemptAt,
    providerMessageId: patch.providerMessageId ?? existing?.providerMessageId,
    lastError: patch.lastError ?? existing?.lastError,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

function buildReminderDeliveryRecord(
  idempotencyKey: string,
  patch: Partial<IntentReminderDeliveryRecord> & {
    reminderId: string
    capsuleAddress: string
    scheduledAt: number
    status: IntentReminderDeliveryRecord['status']
  },
  existing: IntentReminderDeliveryRecord | null
): IntentReminderDeliveryRecord {
  const now = Date.now()
  return {
    idempotencyKey,
    reminderId: patch.reminderId,
    capsuleAddress: patch.capsuleAddress,
    owner: coalesceNonEmpty(patch.owner, existing?.owner),
    recipientEmail: coalesceNonEmpty(patch.recipientEmail, existing?.recipientEmail),
    scheduledAt: patch.scheduledAt,
    status: patch.status,
    attempts: patch.attempts ?? existing?.attempts ?? 0,
    nextAttemptAt: patch.nextAttemptAt ?? existing?.nextAttemptAt,
    providerMessageId: patch.providerMessageId ?? existing?.providerMessageId,
    lastError: patch.lastError ?? existing?.lastError,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export async function upsertIntentSecret(secret: IntentSecretRecord): Promise<IntentSecretRecord> {
  const redis = getRedis()
  if (redis) {
    await redis.set(K.secret(secret.secretRef), secret)
    await redis.sadd(K.secretsSet, secret.secretRef)
    await redis.set(K.secretByOwner(secret.owner), secret.secretRef)
    return secret
  }
  const state = getState()
  state.secrets.set(secret.secretRef, secret)
  persistState(state)
  return secret
}

export async function getIntentSecret(secretRef: string): Promise<IntentSecretRecord | null> {
  const redis = getRedis()
  if (redis) return (await redis.get<IntentSecretRecord>(K.secret(secretRef))) ?? null
  return getState().secrets.get(secretRef) ?? null
}

export async function listIntentSecrets(): Promise<IntentSecretRecord[]> {
  const redis = getRedis()
  if (redis) {
    const refs = await redis.smembers(K.secretsSet)
    return redisMany<IntentSecretRecord>(redis, refs.map(K.secret))
  }
  return Array.from(getState().secrets.values())
}

/**
 * Most recently registered secret for an owner. This is the off-chain source of
 * "is intent delivery enabled for this capsule" now that the lean on-chain
 * capsule carries no intent_data payload.
 */
export async function getIntentSecretByOwner(owner: string): Promise<IntentSecretRecord | null> {
  const redis = getRedis()
  if (redis) {
    const ref = await redis.get<string>(K.secretByOwner(owner))
    if (!ref) return null
    return (await redis.get<IntentSecretRecord>(K.secret(ref))) ?? null
  }
  let latest: IntentSecretRecord | null = null
  for (const secret of getState().secrets.values()) {
    if (secret.owner !== owner) continue
    if (!latest || secret.updatedAt > latest.updatedAt) latest = secret
  }
  return latest
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export async function upsertIntentReminder(reminder: IntentReminderRecord): Promise<IntentReminderRecord> {
  const redis = getRedis()
  if (redis) {
    await redis.set(K.reminder(reminder.reminderId), reminder)
    await redis.sadd(K.remindersSet, reminder.reminderId)
    await redis.set(K.reminderByCapsule(reminder.capsuleAddress), reminder.reminderId)
    return reminder
  }
  const state = getState()
  state.reminders.set(reminder.reminderId, reminder)
  persistState(state)
  return reminder
}

export async function getIntentReminder(reminderId: string): Promise<IntentReminderRecord | null> {
  const redis = getRedis()
  if (redis) return (await redis.get<IntentReminderRecord>(K.reminder(reminderId))) ?? null
  return getState().reminders.get(reminderId) ?? null
}

export async function getIntentReminderByCapsule(capsuleAddress: string): Promise<IntentReminderRecord | null> {
  const redis = getRedis()
  if (redis) {
    const id = await redis.get<string>(K.reminderByCapsule(capsuleAddress))
    if (!id) return null
    return (await redis.get<IntentReminderRecord>(K.reminder(id))) ?? null
  }
  for (const reminder of getState().reminders.values()) {
    if (reminder.capsuleAddress === capsuleAddress) return reminder
  }
  return null
}

export async function listIntentReminders(): Promise<IntentReminderRecord[]> {
  const redis = getRedis()
  if (redis) {
    const ids = await redis.smembers(K.remindersSet)
    const all = await redisMany<IntentReminderRecord>(redis, ids.map(K.reminder))
    return all.sort((a, b) => a.nextReminderAt - b.nextReminderAt)
  }
  return Array.from(getState().reminders.values()).sort((a, b) => a.nextReminderAt - b.nextReminderAt)
}

// ---------------------------------------------------------------------------
// Delivery ledger
// ---------------------------------------------------------------------------

export async function upsertDeliveryLedger(
  idempotencyKey: string,
  patch: Partial<IntentDeliveryLedgerRecord> & {
    capsuleAddress: string
    owner?: string
    executedAt: number
    recipientEmail?: string
    secretRef?: string
    status: IntentDeliveryLedgerRecord['status']
  }
): Promise<IntentDeliveryLedgerRecord> {
  const redis = getRedis()
  if (redis) {
    const existing = await redis.get<IntentDeliveryLedgerRecord>(K.delivery(idempotencyKey))
    const next = buildDeliveryRecord(idempotencyKey, patch, existing ?? null)
    await redis.set(K.delivery(idempotencyKey), next)
    await redis.sadd(K.deliveryByCapsule(next.capsuleAddress), idempotencyKey)
    return next
  }
  const state = getState()
  const next = buildDeliveryRecord(idempotencyKey, patch, state.deliveries.get(idempotencyKey) ?? null)
  state.deliveries.set(idempotencyKey, next)
  persistState(state)
  return next
}

export async function getDeliveryLedger(idempotencyKey: string): Promise<IntentDeliveryLedgerRecord | null> {
  const redis = getRedis()
  if (redis) return (await redis.get<IntentDeliveryLedgerRecord>(K.delivery(idempotencyKey))) ?? null
  return getState().deliveries.get(idempotencyKey) ?? null
}

export async function listDeliveryByCapsule(capsuleAddress: string): Promise<IntentDeliveryLedgerRecord[]> {
  const redis = getRedis()
  if (redis) {
    const keys = await redis.smembers(K.deliveryByCapsule(capsuleAddress))
    const all = await redisMany<IntentDeliveryLedgerRecord>(redis, keys.map(K.delivery))
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  }
  return Array.from(getState().deliveries.values())
    .filter((e) => e.capsuleAddress === capsuleAddress)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

// ---------------------------------------------------------------------------
// Reminder delivery ledger
// ---------------------------------------------------------------------------

export async function upsertReminderDeliveryLedger(
  idempotencyKey: string,
  patch: Partial<IntentReminderDeliveryRecord> & {
    reminderId: string
    capsuleAddress: string
    owner?: string
    recipientEmail?: string
    scheduledAt: number
    status: IntentReminderDeliveryRecord['status']
  }
): Promise<IntentReminderDeliveryRecord> {
  const redis = getRedis()
  if (redis) {
    const existing = await redis.get<IntentReminderDeliveryRecord>(K.reminderDelivery(idempotencyKey))
    const next = buildReminderDeliveryRecord(idempotencyKey, patch, existing ?? null)
    await redis.set(K.reminderDelivery(idempotencyKey), next)
    await redis.sadd(K.reminderDeliveryByCapsule(next.capsuleAddress), idempotencyKey)
    return next
  }
  const state = getState()
  const next = buildReminderDeliveryRecord(
    idempotencyKey,
    patch,
    state.reminderDeliveries.get(idempotencyKey) ?? null
  )
  state.reminderDeliveries.set(idempotencyKey, next)
  persistState(state)
  return next
}

export async function getReminderDeliveryLedger(
  idempotencyKey: string
): Promise<IntentReminderDeliveryRecord | null> {
  const redis = getRedis()
  if (redis) return (await redis.get<IntentReminderDeliveryRecord>(K.reminderDelivery(idempotencyKey))) ?? null
  return getState().reminderDeliveries.get(idempotencyKey) ?? null
}

export async function listReminderDeliveriesByCapsule(
  capsuleAddress: string
): Promise<IntentReminderDeliveryRecord[]> {
  const redis = getRedis()
  if (redis) {
    const keys = await redis.smembers(K.reminderDeliveryByCapsule(capsuleAddress))
    const all = await redisMany<IntentReminderDeliveryRecord>(redis, keys.map(K.reminderDelivery))
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  }
  return Array.from(getState().reminderDeliveries.values())
    .filter((e) => e.capsuleAddress === capsuleAddress)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

// ---------------------------------------------------------------------------
// Distributed claim lock
// ---------------------------------------------------------------------------

/**
 * Best-effort exactly-once claim for a delivery job. On Redis this is an atomic
 * SET NX EX, so only one concurrent worker wins the key and double-sends are
 * prevented even if multiple crons fire at once. In the file fallback (single
 * local process) it is a no-op that always grants the lock.
 */
export async function acquireDeliveryLock(idempotencyKey: string, ttlSeconds: number): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return true
  const result = await redis.set(K.lock(idempotencyKey), '1', { nx: true, ex: ttlSeconds })
  return result === 'OK'
}

export async function releaseDeliveryLock(idempotencyKey: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.del(K.lock(idempotencyKey))
}

import 'server-only'

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import path from 'path'
import { CreDeliveryLedgerRecord, CreSecretRecord } from '@/lib/cre/types'

type CreStoreState = {
  secrets: Map<string, CreSecretRecord>
  deliveries: Map<string, CreDeliveryLedgerRecord>
}

type PersistedCreStoreState = {
  secrets: CreSecretRecord[]
  deliveries: CreDeliveryLedgerRecord[]
}

declare global {
  // eslint-disable-next-line no-var
  var __heresCreStore: CreStoreState | undefined
}

function getStorePath(): string {
  const configuredPath = process.env.CRE_STORE_PATH?.trim()
  if (configuredPath) return configuredPath
  return path.join(process.cwd(), '.data', 'cre-store.json')
}

function loadStateFromDisk(): CreStoreState {
  const storePath = getStorePath()
  if (!existsSync(storePath)) {
    return {
      secrets: new Map<string, CreSecretRecord>(),
      deliveries: new Map<string, CreDeliveryLedgerRecord>(),
    }
  }

  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as PersistedCreStoreState
    const secrets = Array.isArray(parsed.secrets) ? parsed.secrets : []
    const deliveries = Array.isArray(parsed.deliveries) ? parsed.deliveries : []

    return {
      secrets: new Map(secrets.map((entry) => [entry.secretRef, entry])),
      deliveries: new Map(deliveries.map((entry) => [entry.idempotencyKey, entry])),
    }
  } catch {
    return {
      secrets: new Map<string, CreSecretRecord>(),
      deliveries: new Map<string, CreDeliveryLedgerRecord>(),
    }
  }
}

function persistState(state: CreStoreState): void {
  const storePath = getStorePath()
  const dir = path.dirname(storePath)
  mkdirSync(dir, { recursive: true })

  const data: PersistedCreStoreState = {
    secrets: Array.from(state.secrets.values()),
    deliveries: Array.from(state.deliveries.values()),
  }

  const tmpPath = `${storePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmpPath, storePath)
}

function getState(): CreStoreState {
  if (!globalThis.__heresCreStore) {
    globalThis.__heresCreStore = loadStateFromDisk()
  }
  return globalThis.__heresCreStore
}

function coalesceNonEmpty(nextValue: string | undefined, existingValue: string | undefined): string {
  if (typeof nextValue === 'string' && nextValue.trim().length > 0) return nextValue
  return existingValue ?? ''
}

export function upsertCreSecret(secret: CreSecretRecord): CreSecretRecord {
  const state = getState()
  state.secrets.set(secret.secretRef, secret)
  persistState(state)
  return secret
}

export function getCreSecret(secretRef: string): CreSecretRecord | null {
  const state = getState()
  return state.secrets.get(secretRef) ?? null
}

export function listCreSecrets(): CreSecretRecord[] {
  const state = getState()
  return Array.from(state.secrets.values())
}

export function upsertDeliveryLedger(
  idempotencyKey: string,
  patch: Partial<CreDeliveryLedgerRecord> & {
    capsuleAddress: string
    owner?: string
    executedAt: number
    recipientEmail?: string
    secretRef?: string
    status: CreDeliveryLedgerRecord['status']
  }
): CreDeliveryLedgerRecord {
  const state = getState()
  const now = Date.now()
  const existing = state.deliveries.get(idempotencyKey)
  const next: CreDeliveryLedgerRecord = {
    idempotencyKey,
    capsuleAddress: patch.capsuleAddress,
    owner: coalesceNonEmpty(patch.owner, existing?.owner),
    executedAt: patch.executedAt,
    recipientEmail: coalesceNonEmpty(patch.recipientEmail, existing?.recipientEmail),
    secretRef: coalesceNonEmpty(patch.secretRef, existing?.secretRef),
    status: patch.status,
    attempts: patch.attempts ?? existing?.attempts ?? 0,
    providerMessageId: patch.providerMessageId ?? existing?.providerMessageId,
    lastError: patch.lastError ?? existing?.lastError,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  state.deliveries.set(idempotencyKey, next)
  persistState(state)
  return next
}

export function getDeliveryLedger(idempotencyKey: string): CreDeliveryLedgerRecord | null {
  const state = getState()
  return state.deliveries.get(idempotencyKey) ?? null
}

export function listDeliveryByCapsule(capsuleAddress: string): CreDeliveryLedgerRecord[] {
  const state = getState()
  return Array.from(state.deliveries.values())
    .filter((entry) => entry.capsuleAddress === capsuleAddress)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

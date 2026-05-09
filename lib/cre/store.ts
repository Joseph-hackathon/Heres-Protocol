import 'server-only'

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import path from 'path'
import { getDataFilePath } from '@/lib/runtime-paths'
import {
  CreDeliveryLedgerRecord,
  CreReminderDeliveryRecord,
  CreReminderRecord,
  CreSecretRecord,
} from '@/lib/cre/types'

type CreStoreState = {
  secrets: Map<string, CreSecretRecord>
  deliveries: Map<string, CreDeliveryLedgerRecord>
  reminders: Map<string, CreReminderRecord>
  reminderDeliveries: Map<string, CreReminderDeliveryRecord>
}

type PersistedCreStoreState = {
  secrets: CreSecretRecord[]
  deliveries: CreDeliveryLedgerRecord[]
  reminders: CreReminderRecord[]
  reminderDeliveries: CreReminderDeliveryRecord[]
}

declare global {
  // eslint-disable-next-line no-var
  var __heresCreStore: CreStoreState | undefined
}

function getStorePath(): string {
  const configuredPath = process.env.CRE_STORE_PATH?.trim()
  if (configuredPath) return configuredPath
  return getDataFilePath('cre-store.json')
}

function loadStateFromDisk(): CreStoreState {
  const storePath = getStorePath()
  if (!existsSync(storePath)) {
    return {
      secrets: new Map<string, CreSecretRecord>(),
      deliveries: new Map<string, CreDeliveryLedgerRecord>(),
      reminders: new Map<string, CreReminderRecord>(),
      reminderDeliveries: new Map<string, CreReminderDeliveryRecord>(),
    }
  }

  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as PersistedCreStoreState
    const secrets = Array.isArray(parsed.secrets) ? parsed.secrets : []
    const deliveries = Array.isArray(parsed.deliveries) ? parsed.deliveries : []
    const reminders = Array.isArray(parsed.reminders) ? parsed.reminders : []
    const reminderDeliveries = Array.isArray(parsed.reminderDeliveries) ? parsed.reminderDeliveries : []

    return {
      secrets: new Map(secrets.map((entry) => [entry.secretRef, entry])),
      deliveries: new Map(deliveries.map((entry) => [entry.idempotencyKey, entry])),
      reminders: new Map(reminders.map((entry) => [entry.reminderId, entry])),
      reminderDeliveries: new Map(reminderDeliveries.map((entry) => [entry.idempotencyKey, entry])),
    }
  } catch {
    return {
      secrets: new Map<string, CreSecretRecord>(),
      deliveries: new Map<string, CreDeliveryLedgerRecord>(),
      reminders: new Map<string, CreReminderRecord>(),
      reminderDeliveries: new Map<string, CreReminderDeliveryRecord>(),
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
    reminders: Array.from(state.reminders.values()),
    reminderDeliveries: Array.from(state.reminderDeliveries.values()),
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

export function upsertCreReminder(reminder: CreReminderRecord): CreReminderRecord {
  const state = getState()
  state.reminders.set(reminder.reminderId, reminder)
  persistState(state)
  return reminder
}

export function getCreReminder(reminderId: string): CreReminderRecord | null {
  const state = getState()
  return state.reminders.get(reminderId) ?? null
}

export function getCreReminderByCapsule(capsuleAddress: string): CreReminderRecord | null {
  const state = getState()
  for (const reminder of state.reminders.values()) {
    if (reminder.capsuleAddress === capsuleAddress) return reminder
  }
  return null
}

export function listCreReminders(): CreReminderRecord[] {
  const state = getState()
  return Array.from(state.reminders.values()).sort((a, b) => a.nextReminderAt - b.nextReminderAt)
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

export function upsertReminderDeliveryLedger(
  idempotencyKey: string,
  patch: Partial<CreReminderDeliveryRecord> & {
    reminderId: string
    capsuleAddress: string
    owner?: string
    recipientEmail?: string
    scheduledAt: number
    status: CreReminderDeliveryRecord['status']
  }
): CreReminderDeliveryRecord {
  const state = getState()
  const now = Date.now()
  const existing = state.reminderDeliveries.get(idempotencyKey)
  const next: CreReminderDeliveryRecord = {
    idempotencyKey,
    reminderId: patch.reminderId,
    capsuleAddress: patch.capsuleAddress,
    owner: coalesceNonEmpty(patch.owner, existing?.owner),
    recipientEmail: coalesceNonEmpty(patch.recipientEmail, existing?.recipientEmail),
    scheduledAt: patch.scheduledAt,
    status: patch.status,
    attempts: patch.attempts ?? existing?.attempts ?? 0,
    providerMessageId: patch.providerMessageId ?? existing?.providerMessageId,
    lastError: patch.lastError ?? existing?.lastError,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  state.reminderDeliveries.set(idempotencyKey, next)
  persistState(state)
  return next
}

export function getReminderDeliveryLedger(idempotencyKey: string): CreReminderDeliveryRecord | null {
  const state = getState()
  return state.reminderDeliveries.get(idempotencyKey) ?? null
}

export function listReminderDeliveriesByCapsule(capsuleAddress: string): CreReminderDeliveryRecord[] {
  const state = getState()
  return Array.from(state.reminderDeliveries.values())
    .filter((entry) => entry.capsuleAddress === capsuleAddress)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

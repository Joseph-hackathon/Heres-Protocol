// 'dead_letter' = retries exhausted; the engine stops retrying and alerts ops.
// 'dispatched' is retained for back-compat but the self-hosted path sends mail
// inline, so success lands as 'delivered' directly.
export type IntentDeliveryStatus = 'pending' | 'dispatched' | 'delivered' | 'failed' | 'dead_letter'
export type IntentReminderStatus = 'active' | 'paused' | 'stopped'
export type IntentReminderDeliveryStatus = 'pending' | 'dispatched' | 'delivered' | 'failed' | 'dead_letter'

export interface IntentSecretRecord {
  secretRef: string
  secretHash: string
  encryptedPayload: string
  owner: string
  recipientEmail: string
  recipientEmailHash: string
  capsuleAddress?: string
  createdAt: number
  updatedAt: number
}

export interface IntentDeliveryLedgerRecord {
  idempotencyKey: string
  capsuleAddress: string
  owner: string
  executedAt: number
  recipientEmail: string
  secretRef: string
  status: IntentDeliveryStatus
  attempts: number
  // Epoch ms before which a 'failed' record should not be retried (backoff gate).
  nextAttemptAt?: number
  providerMessageId?: string
  lastError?: string
  createdAt: number
  updatedAt: number
}

export interface IntentReminderRecord {
  reminderId: string
  capsuleAddress: string
  owner: string
  recipientEmail: string
  recipientEmailHash: string
  assetSymbol: string
  assetLabel: string
  totalAmount?: string
  beneficiaryCount: number
  inactivityLabel: string
  delayDays: number
  reminderIntervalDays: number
  nextReminderAt: number
  lastReminderAt?: number
  lastDeliveryStatus?: IntentReminderDeliveryStatus
  status: IntentReminderStatus
  createdAt: number
  updatedAt: number
}

export interface IntentReminderDeliveryRecord {
  idempotencyKey: string
  reminderId: string
  capsuleAddress: string
  owner: string
  recipientEmail: string
  scheduledAt: number
  status: IntentReminderDeliveryStatus
  attempts: number
  nextAttemptAt?: number
  providerMessageId?: string
  lastError?: string
  createdAt: number
  updatedAt: number
}

export interface DispatchIntentDeliveryResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  idempotencyKey?: string
  status?: IntentDeliveryStatus
  providerMessageId?: string
  error?: string
}

export interface RegisterIntentReminderResult {
  reminderId: string
  nextReminderAt: number
  recipientEmailHash: string
  reminderIntervalDays: number
}

export interface DispatchIntentReminderResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  reminderId?: string
  idempotencyKey?: string
  status?: IntentReminderDeliveryStatus
  providerMessageId?: string
  error?: string
}

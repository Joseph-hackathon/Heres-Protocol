export type CreDeliveryStatus = 'pending' | 'dispatched' | 'delivered' | 'failed'
export type CreReminderStatus = 'active' | 'paused' | 'stopped'
export type CreReminderDeliveryStatus = 'pending' | 'dispatched' | 'delivered' | 'failed'

export interface CreSecretRecord {
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

export interface CreDeliveryLedgerRecord {
  idempotencyKey: string
  capsuleAddress: string
  owner: string
  executedAt: number
  recipientEmail: string
  secretRef: string
  status: CreDeliveryStatus
  attempts: number
  providerMessageId?: string
  lastError?: string
  createdAt: number
  updatedAt: number
}

export interface CreReminderRecord {
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
  lastDeliveryStatus?: CreReminderDeliveryStatus
  status: CreReminderStatus
  createdAt: number
  updatedAt: number
}

export interface CreReminderDeliveryRecord {
  idempotencyKey: string
  reminderId: string
  capsuleAddress: string
  owner: string
  recipientEmail: string
  scheduledAt: number
  status: CreReminderDeliveryStatus
  attempts: number
  providerMessageId?: string
  lastError?: string
  createdAt: number
  updatedAt: number
}

export interface DispatchCreDeliveryResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  idempotencyKey?: string
  status?: CreDeliveryStatus
  providerMessageId?: string
  error?: string
}

export interface RegisterCreReminderResult {
  reminderId: string
  nextReminderAt: number
  recipientEmailHash: string
  reminderIntervalDays: number
}

export interface DispatchCreReminderResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  reminderId?: string
  idempotencyKey?: string
  status?: CreReminderDeliveryStatus
  providerMessageId?: string
  error?: string
}

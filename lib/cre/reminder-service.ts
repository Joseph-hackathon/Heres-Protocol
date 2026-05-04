import 'server-only'

import { createHmac } from 'crypto'
import { PublicKey } from '@solana/web3.js'
import { safeEqualHex, sha256Hex } from '@/lib/cre/auth'
import { fetchCapsuleStateByAddress } from '@/lib/cre/solana'
import {
  getCreReminder,
  getCreReminderByCapsule,
  getReminderDeliveryLedger,
  listCreReminders,
  listReminderDeliveriesByCapsule,
  upsertCreReminder,
  upsertReminderDeliveryLedger,
} from '@/lib/cre/store'
import {
  CreReminderDeliveryRecord,
  CreReminderDeliveryStatus,
  CreReminderRecord,
  DispatchCreReminderResult,
  RegisterCreReminderResult,
} from '@/lib/cre/types'
import {
  computeNextReminderAt,
  createReminderIdempotencyKey,
  getReminderIntervalDays,
} from '@/lib/cre/reminder-schedule'

type RegisterReminderInput = {
  capsuleAddress: string
  owner: string
  recipientEmail: string
  assetSymbol: string
  assetLabel: string
  totalAmount?: string
  beneficiaryCount: number
  inactivityLabel: string
  delayDays: number
  createdAt?: number
}

type ReminderCallbackInput = {
  idempotencyKey?: string
  capsuleAddress: string
  scheduledAt: number
  status: 'delivered' | 'failed'
  providerMessageId?: string
  error?: string
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function getRequiredEnv(name: string): string | null {
  const value = process.env[name]
  if (!value || !value.trim()) return null
  return value.trim()
}

async function notifyOps(message: string): Promise<void> {
  const webhook = getRequiredEnv('OPS_ALERT_WEBHOOK_URL')
  if (!webhook) return
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
  } catch {
    // Best effort only.
  }
}

async function callReminderWorkflow(payload: {
  reminderId: string
  idempotencyKey: string
  capsuleAddress: string
  owner: string
  recipientEmail: string
  assetSymbol: string
  assetLabel: string
  totalAmount?: string
  beneficiaryCount: number
  inactivityLabel: string
  delayDays: number
  createdAt: number
  scheduledAt: number
  reminderIntervalDays: number
}): Promise<void> {
  const webhook = getRequiredEnv('CHAINLINK_CRE_REMINDER_WEBHOOK_URL')
  if (!webhook) throw new Error('CHAINLINK_CRE_REMINDER_WEBHOOK_URL is not configured')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = getRequiredEnv('CHAINLINK_CRE_REMINDER_API_KEY')
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const signingSecret = getRequiredEnv('CHAINLINK_CRE_REMINDER_SIGNING_SECRET')
  if (signingSecret) {
    const signature = createHmac('sha256', signingSecret).update(JSON.stringify(payload)).digest('hex')
    headers['x-cre-signature'] = signature
  }

  const response = await fetch(webhook, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`CRE reminder webhook error ${response.status}: ${body}`)
  }
}

function stopReminder(reminder: CreReminderRecord, reasonStatus: CreReminderDeliveryStatus): CreReminderRecord {
  return upsertCreReminder({
    ...reminder,
    status: 'stopped',
    lastDeliveryStatus: reasonStatus,
    updatedAt: Date.now(),
  })
}

export function registerCreReminder(input: RegisterReminderInput): RegisterCreReminderResult {
  const now = Number.isFinite(input.createdAt) ? Number(input.createdAt) : Date.now()
  const normalizedEmail = normalizeEmail(input.recipientEmail)
  const reminderIntervalDays = getReminderIntervalDays()
  const nextReminderAt = computeNextReminderAt(now, reminderIntervalDays)
  const existing = getCreReminderByCapsule(input.capsuleAddress)
  const reminderId = existing?.reminderId ?? `rem_${crypto.randomUUID().replace(/-/g, '')}`
  const recipientEmailHash = sha256Hex(normalizedEmail)

  upsertCreReminder({
    reminderId,
    capsuleAddress: input.capsuleAddress,
    owner: input.owner,
    recipientEmail: normalizedEmail,
    recipientEmailHash,
    assetSymbol: input.assetSymbol,
    assetLabel: input.assetLabel,
    totalAmount: input.totalAmount,
    beneficiaryCount: input.beneficiaryCount,
    inactivityLabel: input.inactivityLabel,
    delayDays: input.delayDays,
    reminderIntervalDays,
    nextReminderAt,
    lastReminderAt: existing?.lastReminderAt,
    lastDeliveryStatus: existing?.lastDeliveryStatus,
    status: 'active',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })

  return {
    reminderId,
    nextReminderAt,
    recipientEmailHash,
    reminderIntervalDays,
  }
}

function getReminderByCapsuleOrThrow(capsuleAddress: string): CreReminderRecord | null {
  const reminder = getCreReminderByCapsule(capsuleAddress)
  return reminder ?? null
}

export async function dispatchCreReminderForCapsule(capsuleAddressRaw: string): Promise<DispatchCreReminderResult> {
  const reminder = getReminderByCapsuleOrThrow(capsuleAddressRaw)
  if (!reminder) return { ok: false, error: 'Reminder registration not found' }
  return dispatchCreReminder(reminder.reminderId)
}

export async function dispatchCreReminder(reminderId: string): Promise<DispatchCreReminderResult> {
  const reminder = getCreReminder(reminderId)
  if (!reminder) return { ok: false, error: 'Reminder registration not found' }
  if (reminder.status !== 'active') {
    return { ok: true, skipped: true, reason: `Reminder is ${reminder.status}`, reminderId }
  }

  const now = Date.now()
  if (now < reminder.nextReminderAt) {
    return { ok: true, skipped: true, reason: 'Reminder is not due yet', reminderId }
  }

  let capsuleAddress: PublicKey
  try {
    capsuleAddress = new PublicKey(reminder.capsuleAddress)
  } catch {
    return { ok: false, error: 'Invalid capsule address', reminderId }
  }

  const capsule = await fetchCapsuleStateByAddress(capsuleAddress)
  if (!capsule) {
    stopReminder(reminder, 'failed')
    return { ok: false, error: 'Capsule not found', reminderId }
  }
  if (!capsule.isActive || capsule.executedAt) {
    stopReminder(reminder, 'delivered')
    return { ok: true, skipped: true, reason: 'Capsule is no longer eligible for reminders', reminderId }
  }

  const scheduledAt = reminder.nextReminderAt
  const idempotencyKey = createReminderIdempotencyKey(reminder.capsuleAddress, scheduledAt)
  const existing = getReminderDeliveryLedger(idempotencyKey)
  if (existing && (existing.status === 'pending' || existing.status === 'dispatched' || existing.status === 'delivered')) {
    return {
      ok: true,
      skipped: true,
      reason: `Reminder already ${existing.status}`,
      reminderId,
      idempotencyKey,
      status: existing.status,
      providerMessageId: existing.providerMessageId,
    }
  }

  const attempts = (existing?.attempts ?? 0) + 1
  upsertReminderDeliveryLedger(idempotencyKey, {
    reminderId: reminder.reminderId,
    capsuleAddress: reminder.capsuleAddress,
    owner: reminder.owner,
    recipientEmail: reminder.recipientEmail,
    scheduledAt,
    status: 'pending',
    attempts,
  })

  try {
    await callReminderWorkflow({
      reminderId: reminder.reminderId,
      idempotencyKey,
      capsuleAddress: reminder.capsuleAddress,
      owner: reminder.owner,
      recipientEmail: reminder.recipientEmail,
      assetSymbol: reminder.assetSymbol,
      assetLabel: reminder.assetLabel,
      totalAmount: reminder.totalAmount,
      beneficiaryCount: reminder.beneficiaryCount,
      inactivityLabel: reminder.inactivityLabel,
      delayDays: reminder.delayDays,
      createdAt: reminder.createdAt,
      scheduledAt,
      reminderIntervalDays: reminder.reminderIntervalDays,
    })

    upsertReminderDeliveryLedger(idempotencyKey, {
      reminderId: reminder.reminderId,
      capsuleAddress: reminder.capsuleAddress,
      owner: reminder.owner,
      recipientEmail: reminder.recipientEmail,
      scheduledAt,
      status: 'dispatched',
      attempts,
    })

    upsertCreReminder({
      ...reminder,
      nextReminderAt: computeNextReminderAt(scheduledAt, reminder.reminderIntervalDays),
      lastReminderAt: scheduledAt,
      lastDeliveryStatus: 'dispatched',
      updatedAt: Date.now(),
    })

    return { ok: true, reminderId, idempotencyKey, status: 'dispatched' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    upsertReminderDeliveryLedger(idempotencyKey, {
      reminderId: reminder.reminderId,
      capsuleAddress: reminder.capsuleAddress,
      owner: reminder.owner,
      recipientEmail: reminder.recipientEmail,
      scheduledAt,
      status: 'failed',
      attempts,
      lastError: message,
    })
    upsertCreReminder({
      ...reminder,
      nextReminderAt: computeNextReminderAt(scheduledAt, reminder.reminderIntervalDays),
      lastReminderAt: scheduledAt,
      lastDeliveryStatus: 'failed',
      updatedAt: Date.now(),
    })
    await notifyOps(`[Heres Reminder] Delivery failed: ${reminder.capsuleAddress} (${message})`)
    return { ok: false, error: message, reminderId, idempotencyKey, status: 'failed' }
  }
}

export function applyCreReminderCallback(input: ReminderCallbackInput): CreReminderDeliveryRecord {
  const idempotencyKey =
    input.idempotencyKey || createReminderIdempotencyKey(input.capsuleAddress, Number(input.scheduledAt))
  const existing = getReminderDeliveryLedger(idempotencyKey)
  const reminder = getReminderByCapsuleOrThrow(input.capsuleAddress)
  const status = input.status as CreReminderDeliveryStatus

  if (reminder) {
    upsertCreReminder({
      ...reminder,
      lastReminderAt: Number(input.scheduledAt),
      lastDeliveryStatus: status,
      updatedAt: Date.now(),
    })
  }

  return upsertReminderDeliveryLedger(idempotencyKey, {
    reminderId: existing?.reminderId ?? reminder?.reminderId ?? '',
    capsuleAddress: input.capsuleAddress,
    owner: existing?.owner ?? reminder?.owner,
    recipientEmail: existing?.recipientEmail ?? reminder?.recipientEmail,
    scheduledAt: Number(input.scheduledAt),
    status,
    attempts: existing?.attempts ?? 0,
    providerMessageId: input.providerMessageId,
    lastError: input.error,
  })
}

export function verifyCreReminderCallbackSignature(rawBody: string, signature: string | null): boolean {
  const secret = getRequiredEnv('CHAINLINK_CRE_REMINDER_CALLBACK_SECRET')
  if (!secret) return true
  if (!signature) return false

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return safeEqualHex(expected, signature)
}

export function getReminderStatus(capsuleAddress: string): {
  reminder: CreReminderRecord | null
  deliveries: CreReminderDeliveryRecord[]
} {
  return {
    reminder: getCreReminderByCapsule(capsuleAddress),
    deliveries: listReminderDeliveriesByCapsule(capsuleAddress),
  }
}

export async function reconcileCreReminders(): Promise<{
  scanned: number
  due: number
  dispatched: number
  failed: number
  skipped: number
}> {
  const reminders = listCreReminders()
  const now = Date.now()
  let due = 0
  let dispatched = 0
  let failed = 0
  let skipped = 0

  for (const reminder of reminders) {
    if (reminder.status !== 'active') continue
    if (reminder.nextReminderAt > now) continue

    due += 1
    const result = await dispatchCreReminder(reminder.reminderId)
    if (result.ok && !result.skipped) dispatched += 1
    if (!result.ok) failed += 1
    if (result.skipped) skipped += 1
  }

  return {
    scanned: reminders.length,
    due,
    dispatched,
    failed,
    skipped,
  }
}

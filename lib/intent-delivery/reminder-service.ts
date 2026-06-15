import 'server-only'

import { randomUUID } from 'crypto'
import { PublicKey } from '@solana/web3.js'
import { sha256Hex } from '@/lib/intent-delivery/auth'
import { sendEmail } from '@/lib/intent-delivery/email'
import { renderReminderEmail } from '@/lib/intent-delivery/email-templates'
import { fetchCapsuleStateByAddress } from '@/lib/intent-delivery/solana'
import {
  acquireDeliveryLock,
  releaseDeliveryLock,
  getIntentReminder,
  getIntentReminderByCapsule,
  getReminderDeliveryLedger,
  listIntentReminders,
  listReminderDeliveriesByCapsule,
  upsertIntentReminder,
  upsertReminderDeliveryLedger,
} from '@/lib/intent-delivery/store'
import {
  IntentReminderDeliveryRecord,
  IntentReminderDeliveryStatus,
  IntentReminderRecord,
  DispatchIntentReminderResult,
  RegisterIntentReminderResult,
} from '@/lib/intent-delivery/types'
import {
  computeNextReminderAt,
  createReminderIdempotencyKey,
  getReminderIntervalDays,
} from '@/lib/intent-delivery/reminder-schedule'

const LOCK_TTL_SECONDS = 120

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

async function stopReminder(
  reminder: IntentReminderRecord,
  reasonStatus: IntentReminderDeliveryStatus
): Promise<IntentReminderRecord> {
  return upsertIntentReminder({
    ...reminder,
    status: 'stopped',
    lastDeliveryStatus: reasonStatus,
    updatedAt: Date.now(),
  })
}

export async function registerIntentReminder(input: RegisterReminderInput): Promise<RegisterIntentReminderResult> {
  const now = Number.isFinite(input.createdAt) ? Number(input.createdAt) : Date.now()
  const normalizedEmail = normalizeEmail(input.recipientEmail)
  const reminderIntervalDays = getReminderIntervalDays()
  const nextReminderAt = computeNextReminderAt(now, reminderIntervalDays)
  const existing = await getIntentReminderByCapsule(input.capsuleAddress)
  const reminderId = existing?.reminderId ?? `rem_${randomUUID().replace(/-/g, '')}`
  const recipientEmailHash = sha256Hex(normalizedEmail)

  await upsertIntentReminder({
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

  return { reminderId, nextReminderAt, recipientEmailHash, reminderIntervalDays }
}

export async function dispatchIntentReminderForCapsule(
  capsuleAddressRaw: string
): Promise<DispatchIntentReminderResult> {
  const reminder = await getIntentReminderByCapsule(capsuleAddressRaw)
  if (!reminder) return { ok: false, error: 'Reminder registration not found' }
  return dispatchIntentReminder(reminder.reminderId)
}

export async function dispatchIntentReminder(reminderId: string): Promise<DispatchIntentReminderResult> {
  const reminder = await getIntentReminder(reminderId)
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
    await stopReminder(reminder, 'failed')
    return { ok: false, error: 'Capsule not found', reminderId }
  }
  if (!capsule.isActive || capsule.executedAt) {
    await stopReminder(reminder, 'delivered')
    return { ok: true, skipped: true, reason: 'Capsule is no longer eligible for reminders', reminderId }
  }

  const scheduledAt = reminder.nextReminderAt
  const idempotencyKey = createReminderIdempotencyKey(reminder.capsuleAddress, scheduledAt)

  const claimed = await acquireDeliveryLock(idempotencyKey, LOCK_TTL_SECONDS)
  if (!claimed) {
    return { ok: true, skipped: true, reason: 'Reminder in progress', reminderId, idempotencyKey }
  }

  try {
    const existing = await getReminderDeliveryLedger(idempotencyKey)
    if (existing && (existing.status === 'delivered' || existing.status === 'dispatched')) {
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
    await upsertReminderDeliveryLedger(idempotencyKey, {
      reminderId: reminder.reminderId,
      capsuleAddress: reminder.capsuleAddress,
      owner: reminder.owner,
      recipientEmail: reminder.recipientEmail,
      scheduledAt,
      status: 'pending',
      attempts,
    })

    try {
      const { subject, html, text } = renderReminderEmail({
        assetLabel: reminder.assetLabel,
        totalAmount: reminder.totalAmount,
        beneficiaryCount: reminder.beneficiaryCount,
        inactivityLabel: reminder.inactivityLabel,
        capsuleAddress: reminder.capsuleAddress,
      })
      const { providerMessageId } = await sendEmail({ to: reminder.recipientEmail, subject, html, text })

      await upsertReminderDeliveryLedger(idempotencyKey, {
        reminderId: reminder.reminderId,
        capsuleAddress: reminder.capsuleAddress,
        owner: reminder.owner,
        recipientEmail: reminder.recipientEmail,
        scheduledAt,
        status: 'delivered',
        attempts,
        providerMessageId,
      })
      // Reminders recur: advance the schedule whether or not this one landed.
      await upsertIntentReminder({
        ...reminder,
        nextReminderAt: computeNextReminderAt(scheduledAt, reminder.reminderIntervalDays),
        lastReminderAt: scheduledAt,
        lastDeliveryStatus: 'delivered',
        updatedAt: Date.now(),
      })

      return { ok: true, reminderId, idempotencyKey, status: 'delivered', providerMessageId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await upsertReminderDeliveryLedger(idempotencyKey, {
        reminderId: reminder.reminderId,
        capsuleAddress: reminder.capsuleAddress,
        owner: reminder.owner,
        recipientEmail: reminder.recipientEmail,
        scheduledAt,
        status: 'failed',
        attempts,
        lastError: message,
      })
      // A missed reminder self-heals at the next interval; advance regardless.
      await upsertIntentReminder({
        ...reminder,
        nextReminderAt: computeNextReminderAt(scheduledAt, reminder.reminderIntervalDays),
        lastReminderAt: scheduledAt,
        lastDeliveryStatus: 'failed',
        updatedAt: Date.now(),
      })
      await notifyOps(`[Heres Reminder] Delivery failed: ${reminder.capsuleAddress} (${message})`)
      return { ok: false, error: message, reminderId, idempotencyKey, status: 'failed' }
    }
  } finally {
    await releaseDeliveryLock(idempotencyKey)
  }
}

export async function getReminderStatus(capsuleAddress: string): Promise<{
  reminder: IntentReminderRecord | null
  deliveries: IntentReminderDeliveryRecord[]
}> {
  const [reminder, deliveries] = await Promise.all([
    getIntentReminderByCapsule(capsuleAddress),
    listReminderDeliveriesByCapsule(capsuleAddress),
  ])
  return { reminder, deliveries }
}

export async function reconcileIntentReminders(): Promise<{
  scanned: number
  due: number
  dispatched: number
  failed: number
  skipped: number
}> {
  const reminders = await listIntentReminders()
  const now = Date.now()
  let due = 0
  let dispatched = 0
  let failed = 0
  let skipped = 0

  for (const reminder of reminders) {
    if (reminder.status !== 'active') continue
    if (reminder.nextReminderAt > now) continue

    due += 1
    const result = await dispatchIntentReminder(reminder.reminderId)
    if (result.ok && !result.skipped) dispatched += 1
    if (!result.ok) failed += 1
    if (result.skipped) skipped += 1
  }

  return { scanned: reminders.length, due, dispatched, failed, skipped }
}

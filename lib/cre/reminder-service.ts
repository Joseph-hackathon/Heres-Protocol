import 'server-only'

import { randomUUID } from 'crypto'
import { PublicKey } from '@solana/web3.js'
import { sha256Hex } from '@/lib/cre/auth'
import { sendEmail } from '@/lib/cre/email'
import { renderReminderEmail } from '@/lib/cre/email-templates'
import { fetchCapsuleStateByAddress } from '@/lib/cre/solana'
import {
  acquireDeliveryLock,
  releaseDeliveryLock,
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
  reminder: CreReminderRecord,
  reasonStatus: CreReminderDeliveryStatus
): Promise<CreReminderRecord> {
  return upsertCreReminder({
    ...reminder,
    status: 'stopped',
    lastDeliveryStatus: reasonStatus,
    updatedAt: Date.now(),
  })
}

export async function registerCreReminder(input: RegisterReminderInput): Promise<RegisterCreReminderResult> {
  const now = Number.isFinite(input.createdAt) ? Number(input.createdAt) : Date.now()
  const normalizedEmail = normalizeEmail(input.recipientEmail)
  const reminderIntervalDays = getReminderIntervalDays()
  const nextReminderAt = computeNextReminderAt(now, reminderIntervalDays)
  const existing = await getCreReminderByCapsule(input.capsuleAddress)
  const reminderId = existing?.reminderId ?? `rem_${randomUUID().replace(/-/g, '')}`
  const recipientEmailHash = sha256Hex(normalizedEmail)

  await upsertCreReminder({
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

export async function dispatchCreReminderForCapsule(
  capsuleAddressRaw: string
): Promise<DispatchCreReminderResult> {
  const reminder = await getCreReminderByCapsule(capsuleAddressRaw)
  if (!reminder) return { ok: false, error: 'Reminder registration not found' }
  return dispatchCreReminder(reminder.reminderId)
}

export async function dispatchCreReminder(reminderId: string): Promise<DispatchCreReminderResult> {
  const reminder = await getCreReminder(reminderId)
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
      await upsertCreReminder({
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
      await upsertCreReminder({
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
  reminder: CreReminderRecord | null
  deliveries: CreReminderDeliveryRecord[]
}> {
  const [reminder, deliveries] = await Promise.all([
    getCreReminderByCapsule(capsuleAddress),
    listReminderDeliveriesByCapsule(capsuleAddress),
  ])
  return { reminder, deliveries }
}

export async function reconcileCreReminders(): Promise<{
  scanned: number
  due: number
  dispatched: number
  failed: number
  skipped: number
}> {
  const reminders = await listCreReminders()
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

  return { scanned: reminders.length, due, dispatched, failed, skipped }
}

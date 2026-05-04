const REMINDER_INTERVAL_DAYS = 30

export function computeNextReminderAt(baseTimestamp: number, intervalDays = REMINDER_INTERVAL_DAYS): number {
  return baseTimestamp + intervalDays * 24 * 60 * 60 * 1000
}

export function createReminderIdempotencyKey(capsuleAddress: string, scheduledAt: number): string {
  return `${capsuleAddress}:${scheduledAt}`
}

export function getReminderIntervalDays(): number {
  const raw = process.env.CRE_REMINDER_INTERVAL_DAYS?.trim()
  if (!raw) return REMINDER_INTERVAL_DAYS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return REMINDER_INTERVAL_DAYS
  return parsed
}

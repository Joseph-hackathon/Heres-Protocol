const REMINDER_INTERVAL_DAYS = 30

export function computeNextReminderAt(baseTimestamp: number, intervalDays = REMINDER_INTERVAL_DAYS): number {
  return baseTimestamp + intervalDays * 24 * 60 * 60 * 1000
}

export function createReminderIdempotencyKey(capsuleAddress: string, scheduledAt: number): string {
  return `${capsuleAddress}:${scheduledAt}`
}

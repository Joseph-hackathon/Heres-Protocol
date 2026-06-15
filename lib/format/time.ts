/**
 * Canonical time formatting. Replaces the two timeAgo impls (dashboard,
 * capsule-detail) and the lone formatDateTime. `fallback` covers the null /
 * not-yet-known case so callers stop hardcoding '...' vs '-'.
 */
export function timeAgo(timestampMs: number | null | undefined, fallback = '...'): string {
  if (!timestampMs) return fallback
  const diff = Math.max(0, Date.now() - timestampMs)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDateTime(timestampMs: number | null | undefined, fallback = '...'): string {
  if (!timestampMs) return fallback
  return new Date(timestampMs).toLocaleString()
}

export function formatDate(timestampMs: number | null | undefined, fallback = '...'): string {
  if (!timestampMs) return fallback
  return new Date(timestampMs).toLocaleDateString()
}

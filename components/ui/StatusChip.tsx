import type { LucideIcon } from 'lucide-react'
import { Activity, CheckCircle2, Circle, Clock, Lock, AlertTriangle, XCircle, Loader2 } from 'lucide-react'
import { cn } from './utils'

/**
 * Canonical capsule status pill. Replaces the inline status rendering in
 * dashboard + capsule-detail. Status is never color-only: every state pairs a
 * tinted dot/icon with text. Accepts the app's status strings (case-insensitive)
 * plus a few aliases.
 */
export type CapsuleStatus =
  | 'active'
  | 'expired'
  | 'executed'
  | 'waiting'
  | 'delegated'
  | 'failed'
  | 'pending'

interface StatusMeta {
  label: string
  icon: LucideIcon
  className: string
  /** Live pulse on the icon (only for the "alive" active state). */
  pulse?: boolean
}

const STATUS: Record<CapsuleStatus, StatusMeta> = {
  active: { label: 'Active', icon: Activity, className: 'text-brand border-brand/30 bg-brand/10', pulse: true },
  expired: { label: 'Expired', icon: AlertTriangle, className: 'text-warn border-warn/30 bg-warn/10' },
  executed: { label: 'Executed', icon: CheckCircle2, className: 'text-ash border-hair bg-white/5' },
  waiting: { label: 'Waiting', icon: Clock, className: 'text-ash border-hair bg-white/5' },
  delegated: { label: 'Delegated', icon: Lock, className: 'text-brand border-brand/30 bg-brand/10' },
  failed: { label: 'Failed', icon: XCircle, className: 'text-danger border-danger/30 bg-danger/10' },
  pending: { label: 'Pending', icon: Loader2, className: 'text-ash border-hair bg-white/5' },
}

// Aliases for the words the pages already use.
const ALIASES: Record<string, CapsuleStatus> = {
  alive: 'active',
  settled: 'executed',
  inactive: 'waiting',
}

// Neutral fallback for statuses outside the known set (e.g. event-feed words
// like Created/Updated/Activity/Verified). Shows the raw word, not "Waiting".
const NEUTRAL: StatusMeta = { label: '', icon: Circle, className: 'text-ash border-hair bg-white/5' }

function resolve(status: string): CapsuleStatus | null {
  const key = status.toLowerCase()
  if (key in STATUS) return key as CapsuleStatus
  if (key in ALIASES) return ALIASES[key]
  return null
}

export function StatusChip({
  status,
  label,
  className,
}: {
  status: string
  label?: string
  className?: string
}) {
  const key = resolve(status)
  const meta = key ? STATUS[key] : NEUTRAL
  const Icon = meta.icon
  const text = label ?? (key ? meta.label : status)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        meta.className,
        className
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', meta.pulse && 'animate-pulse', key === 'pending' && 'animate-spin')} aria-hidden />
      {text}
    </span>
  )
}

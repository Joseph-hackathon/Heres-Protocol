import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { formatDelta } from '@/lib/format'
import { Card } from './Card'
import { cn } from './utils'

export interface StatTileProps {
  label: ReactNode
  value: ReactNode
  /** Percentage change. Sign drives color + arrow honestly. */
  delta?: number
  sparkline?: ReactNode
  className?: string
}

/**
 * Dashboard stat cell: label, big value, honest delta (negative is red with a
 * down arrow, never a green up arrow on a drop), optional sparkline slot.
 */
export function StatTile({ label, value, delta, sparkline, className }: StatTileProps) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta)
  const positive = hasDelta && (delta as number) >= 0

  return (
    <Card className={cn('p-5', className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ash">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <span className="tnum text-2xl font-semibold text-vellum">{value}</span>
        {sparkline}
      </div>
      {hasDelta && (
        <span
          className={cn(
            'mt-2 inline-flex items-center gap-1 text-xs font-medium',
            positive ? 'text-brand' : 'text-danger'
          )}
        >
          {positive ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
          {formatDelta(delta as number)}
        </span>
      )}
    </Card>
  )
}

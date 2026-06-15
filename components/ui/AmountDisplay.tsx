import { formatAmount } from '@/lib/format'
import { cn } from './utils'

export interface AmountDisplayProps {
  value: number
  symbol?: string
  decimals?: number
  signed?: boolean
  className?: string
  /** Right-align for table columns. */
  align?: 'left' | 'right'
}

/**
 * Numeric amount with tabular figures so columns align. Value in vellum, the
 * unit symbol in ash.
 */
export function AmountDisplay({
  value,
  symbol,
  decimals = 4,
  signed = false,
  align = 'left',
  className,
}: AmountDisplayProps) {
  return (
    <span
      className={cn(
        'tnum inline-flex items-baseline gap-1 text-vellum',
        align === 'right' && 'justify-end text-right',
        className
      )}
    >
      {formatAmount(value, { decimals, signed })}
      {symbol && <span className="text-ash">{symbol}</span>}
    </span>
  )
}

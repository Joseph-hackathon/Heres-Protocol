import { forwardRef } from 'react'
import { cn } from './utils'

type CardTone = 'default' | 'accent' | 'warning' | 'danger'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: CardTone
  /** Adds a subtle hover lift for clickable/linked cards. */
  interactive?: boolean
}

const TONES: Record<CardTone, string> = {
  default: 'border-hair',
  accent: 'border-brand/20',
  warning: 'border-warn/30',
  danger: 'border-danger/30',
}

/**
 * Hairline surface card. The Quiet Ledger "cell": thin border, ambient
 * shadow, no glow. `tone` tints the border for accent/warning/danger contexts.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = 'default', interactive = false, className, children, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border bg-card shadow-[var(--shadow-amb)]',
        TONES[tone],
        interactive && 'transition-colors duration-150 hover:border-brand/40',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
})

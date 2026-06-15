import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from './utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  // Flat brand cyan on dark ink text. The one solid call-to-action.
  primary: 'bg-brand text-ink hover:bg-brand/90 disabled:hover:bg-brand',
  secondary:
    'border border-hair bg-card text-vellum hover:border-brand/40 hover:text-brand disabled:hover:border-hair disabled:hover:text-vellum',
  ghost: 'text-ash hover:text-vellum hover:bg-white/5',
  // Reserved for irreversible/destructive actions only.
  danger: 'bg-danger text-white hover:bg-danger/90 disabled:hover:bg-danger',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
}

/**
 * The one button. Variants: primary (solid cyan) | secondary | ghost | danger.
 * Accessible focus ring, 44px touch target at md, built-in loading spinner.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
})

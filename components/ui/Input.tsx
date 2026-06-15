import { forwardRef } from 'react'
import { cn } from './utils'

const baseControl =
  'w-full rounded-lg border border-hair bg-surface px-3 py-2 text-sm text-vellum placeholder:text-ash ' +
  'transition-colors duration-150 focus-visible:outline-none focus-visible:border-brand/50 ' +
  'focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-[invalid=true]:border-danger/60 aria-[invalid=true]:focus-visible:ring-danger/30'

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(baseControl, className)} {...props} />
  }
)

export { baseControl }

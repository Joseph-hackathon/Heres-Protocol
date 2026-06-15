import { cn } from './utils'

/**
 * Loading placeholder. Honors prefers-reduced-motion via the global block in
 * globals.css (animate-pulse is disabled there).
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-white/5', className)}
      aria-hidden
      {...props}
    />
  )
}

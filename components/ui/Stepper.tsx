import { Check } from 'lucide-react'
import { cn } from './utils'

export interface StepperProps {
  steps: string[]
  /** Zero-based index of the active step. */
  current: number
  className?: string
}

/**
 * Horizontal step indicator shared by the create wizard and the detail action
 * flow. Completed steps show a Check; the current step is highlighted.
 */
export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <ol className={cn('flex items-center gap-2', className)} aria-label="Progress">
      {steps.map((label, i) => {
        const complete = i < current
        const active = i === current
        return (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                complete && 'border-brand bg-brand text-ink',
                active && 'border-brand text-brand',
                !complete && !active && 'border-hair text-ash'
              )}
            >
              {complete ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
            <span
              className={cn(
                'truncate text-sm',
                active ? 'font-medium text-vellum' : 'text-ash'
              )}
            >
              {label}
            </span>
            {i < steps.length - 1 && <span className={cn('h-px flex-1', complete ? 'bg-brand/40' : 'bg-hair')} aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

import { cloneElement, isValidElement, useId, type ReactElement } from 'react'
import { cn } from './utils'

export interface FieldProps {
  label: string
  /** Single control element (Input/Textarea/Select). Gets id + aria wired in. */
  children: ReactElement
  error?: string
  hint?: string
  required?: boolean
  className?: string
}

/**
 * Label + control + hint/error wrapper with accessibility wired automatically:
 * the control receives id, aria-describedby (hint/error) and aria-invalid.
 */
export function Field({ label, children, error, hint, required, className }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })
    : children

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-vellum">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ash">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

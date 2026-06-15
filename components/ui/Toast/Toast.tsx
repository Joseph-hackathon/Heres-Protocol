'use client'

import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '../utils'
import type { ToastItem } from './useToast'

const ICONS = { success: CheckCircle2, error: XCircle, info: Info } as const
const TONES = { success: 'border-brand/30', error: 'border-danger/40', info: 'border-hair' } as const
const ICON_TONES = { success: 'text-brand', error: 'text-danger', info: 'text-ash' } as const

export function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const Icon = ICONS[item.variant]
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border bg-card px-4 py-3 shadow-[var(--shadow-amb)]',
        TONES[item.variant]
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', ICON_TONES[item.variant])} aria-hidden />
      <p className="text-sm text-vellum">{item.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss"
        className="ml-auto shrink-0 text-ash transition-colors hover:text-vellum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

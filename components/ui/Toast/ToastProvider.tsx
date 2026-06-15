'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Toast } from './Toast'
import { ToastContext, type ToastItem, type ToastOptions } from './useToast'

/**
 * App-wide toast host. Wrap the tree once (in app/providers.tsx) and call
 * useToast() anywhere. Renders into a portal with an aria-live region so tx
 * status reaches screen readers.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const [mounted, setMounted] = useState(false)

  // SSR-safe portal guard: only render into document.body after client mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const item: ToastItem = {
        id,
        message: opts.message,
        variant: opts.variant ?? 'info',
        duration: opts.duration ?? 4000,
      }
      setItems((prev) => [...prev, item])
      if (item.duration > 0) setTimeout(() => dismiss(id), item.duration)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {mounted &&
        createPortal(
          <div
            className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
            aria-live="polite"
            aria-atomic="false"
          >
            {items.map((item) => (
              <Toast key={item.id} item={item} onDismiss={dismiss} />
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  )
}

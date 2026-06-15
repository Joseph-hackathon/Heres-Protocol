'use client'

import { createContext, useContext } from 'react'

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastOptions {
  message: string
  variant?: ToastVariant
  /** Auto-dismiss after ms. 0 keeps it until manually dismissed. Default 4000. */
  duration?: number
}

export interface ToastItem {
  id: string
  message: string
  variant: ToastVariant
  duration: number
}

export interface ToastApi {
  toast: (opts: ToastOptions) => void
  dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

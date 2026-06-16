'use client'

import { useCallback, useState } from 'react'
import { useToast } from '@/components/ui'
import { normalizeTxError } from '@/lib/errors'
import { getExplorerUrl } from '@/constants'

/**
 * Cross-cutting transaction state machine.
 *
 * Wraps any async action that produces a signature and gives the UI a single,
 * consistent surface: a phase, the resulting signature + explorer link, a
 * normalized error string, and toast feedback. This is the canonical write path -
 * reads live in React Query (`useQuery`), writes go through `run()` here and then
 * invalidate the relevant query keys inside the action.
 *
 * Most `lib/solana` tx fns are atomic from the caller's view (build+sign+send+
 * confirm in one await), so the default phase while awaiting is 'awaiting-signature'.
 * Multi-step flows (e.g. create's batched create+delegate+TEE) can drive finer
 * phases via the `setPhase` helper passed to the action.
 */
export type TxPhase =
  | 'idle'
  | 'building'
  | 'awaiting-signature'
  | 'sending'
  | 'confirming'
  | 'confirmed'
  | 'failed'

const PENDING_PHASES: readonly TxPhase[] = ['building', 'awaiting-signature', 'sending', 'confirming']

export interface TxRunHelpers {
  /** Advance the machine from inside a multi-step action. */
  setPhase: (phase: TxPhase) => void
}

export interface TxRunOptions {
  /** Toast shown on success. Omit to stay silent (caller surfaces its own UI). */
  successMessage?: string
  /** Override the normalized error string used for state + toast. */
  errorMessage?: string
  /** Toast on failure. Default true. */
  toastOnError?: boolean
  /** Phase to enter while the action runs. Default 'awaiting-signature'. */
  initialPhase?: TxPhase
}

export interface UseTxLifecycle {
  phase: TxPhase
  signature: string | null
  explorerUrl: string | null
  error: string | null
  isPending: boolean
  isConfirmed: boolean
  isFailed: boolean
  /**
   * Run an async tx action. If it resolves to a string, that's recorded as the
   * signature (and an explorer link is derived). Returns the action's result, or
   * `undefined` if it threw (the error is captured in state + toasted).
   */
  run: <T extends string | void>(
    action: (helpers: TxRunHelpers) => Promise<T>,
    options?: TxRunOptions
  ) => Promise<T | undefined>
  setPhase: (phase: TxPhase) => void
  reset: () => void
}

export function useTxLifecycle(): UseTxLifecycle {
  const { toast } = useToast()
  const [phase, setPhase] = useState<TxPhase>('idle')
  const [signature, setSignature] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setPhase('idle')
    setSignature(null)
    setError(null)
  }, [])

  const run = useCallback(
    async <T extends string | void>(
      action: (helpers: TxRunHelpers) => Promise<T>,
      options: TxRunOptions = {}
    ): Promise<T | undefined> => {
      const {
        successMessage,
        errorMessage,
        toastOnError = true,
        initialPhase = 'awaiting-signature',
      } = options

      setError(null)
      setSignature(null)
      setPhase(initialPhase)

      try {
        const result = await action({ setPhase })
        setSignature(typeof result === 'string' ? result : null)
        setPhase('confirmed')
        if (successMessage) toast({ message: successMessage, variant: 'success' })
        return result
      } catch (err) {
        const msg = errorMessage ?? normalizeTxError(err)
        setError(msg)
        setPhase('failed')
        if (toastOnError) toast({ message: msg, variant: 'error' })
        return undefined
      }
    },
    [toast]
  )

  return {
    phase,
    signature,
    explorerUrl: signature ? getExplorerUrl('tx', signature) : null,
    error,
    isPending: PENDING_PHASES.includes(phase),
    isConfirmed: phase === 'confirmed',
    isFailed: phase === 'failed',
    run,
    setPhase,
    reset,
  }
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, KeyRound, Loader2, LogOut, Send } from 'lucide-react'
import { usePrivy, type WalletWithMetadata } from '@privy-io/react-auth'
import { useExportWallet } from '@privy-io/react-auth/solana'
import { useHeresWallet } from '@/hooks/useHeresWallet'
import { useSolBalance } from '@/hooks/queries/useSolBalance'
import { formatSol } from '@/lib/format'
import { cn, useToast } from '@/components/ui'
import { SendFundsDialog } from '@/components/SendFundsDialog'

function truncate(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

/**
 * Replacement for wallet-adapter's WalletMultiButton.
 *
 * Not authenticated -> opens Privy's email login modal.
 * Authenticated     -> shows the embedded wallet address; click opens a menu to
 *                      copy the full address, send funds, securely export the
 *                      embedded wallet private key through Privy, or log out.
 *
 * Accepts `className` so call sites can keep their existing layout overrides; it
 * is applied to the trigger button. `w-full` in the className makes the trigger
 * (and its wrapper) stretch so the mobile drawer button still fills its row.
 */
export function PrivyLoginButton({ className = '' }: { className?: string }) {
  const { ready, authenticated, user, login, logout } = usePrivy()
  const { exportWallet } = useExportWallet()
  const { toast } = useToast()
  const wallet = useHeresWallet()
  const { publicKey } = wallet
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const address = publicKey?.toBase58() ?? ''
  const embeddedWallet = user?.linkedAccounts.find(
    (account): account is WalletWithMetadata =>
      account.type === 'wallet' &&
      account.walletClientType === 'privy' &&
      account.chainType === 'solana' &&
      account.address === address
  )
  const fullWidth = /\bw-full\b/.test(className)
  const { lamports, isLoading: balanceLoading, refetch: refetchBalance } = useSolBalance(publicKey)

  // Pull a fresh balance whenever the menu opens (e.g. right after a devnet airdrop).
  useEffect(() => {
    if (open) refetchBalance()
  }, [open, refetchBalance])

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    []
  )

  const copyAddress = useCallback(() => {
    if (!address || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1400)
    })
  }, [address])

  const handleExportWallet = useCallback(async () => {
    if (!embeddedWallet) {
      toast({ message: 'Only your Privy embedded wallet can be exported.', variant: 'error' })
      return
    }

    setOpen(false)
    setExporting(true)
    try {
      // Privy reveals the key in its isolated export modal. Heres never receives it.
      await exportWallet({ address: embeddedWallet.address })
    } catch {
      toast({ message: 'Wallet export could not be opened. Please try again.', variant: 'error' })
    } finally {
      setExporting(false)
    }
  }, [embeddedWallet, exportWallet, toast])

  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

  if (!ready) {
    return (
      <button type="button" disabled className={cn(base, 'bg-Heres-surface text-Heres-muted', className)}>
        Loading...
      </button>
    )
  }

  if (!authenticated) {
    return (
      <button
        type="button"
        onClick={() => login()}
        className={cn(base, 'bg-Heres-accent text-Heres-bg hover:opacity-90', className)}
      >
        Sign in
      </button>
    )
  }

  return (
    <div ref={rootRef} className={cn('relative inline-flex', fullWidth && 'w-full')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Wallet menu"
        className={cn(
          base,
          'border border-Heres-border bg-Heres-surface/80 text-Heres-white hover:bg-Heres-card',
          fullWidth && 'w-full',
          className
        )}
      >
        <span className="font-mono">{publicKey ? truncate(address) : 'Connected'}</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 opacity-70 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          style={{ boxShadow: 'var(--shadow-amb)' }}
          className="absolute right-0 top-full z-50 mt-2 w-72 origin-top-right overflow-hidden rounded-2xl border border-Heres-border bg-Heres-card/95 backdrop-blur-xl"
        >
          <div className="px-4 pb-3.5 pt-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-Heres-muted">
              Balance
            </p>
            <p className="mt-1.5 font-serif text-2xl leading-none text-Heres-white tabular-nums">
              {lamports === null ? (
                <span className={cn('text-Heres-muted', balanceLoading && 'animate-pulse')}>—</span>
              ) : (
                formatSol(lamports, 4)
              )}
              <span className="ml-1.5 font-sans text-sm text-Heres-muted">SOL</span>
            </p>
          </div>

          <div className="border-t border-Heres-border">
            <button
              type="button"
              role="menuitem"
              onClick={copyAddress}
              className="group flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium text-Heres-white transition-colors hover:bg-Heres-accent/10 hover:text-Heres-accent"
            >
              {copied ? (
                <Check className="h-4 w-4 text-Heres-accent" aria-hidden />
              ) : (
                <Copy className="h-4 w-4 text-Heres-muted transition-colors group-hover:text-Heres-accent" aria-hidden />
              )}
              {copied ? 'Copied!' : 'Copy address'}
              <span className="sr-only" aria-live="polite">
                {copied ? 'Address copied to clipboard' : ''}
              </span>
            </button>

            {publicKey && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  setSendOpen(true)
                }}
                className="group flex w-full items-center gap-2.5 border-t border-Heres-border px-4 py-3 text-left text-sm font-medium text-Heres-white transition-colors hover:bg-Heres-accent/10 hover:text-Heres-accent"
              >
                <Send className="h-4 w-4 text-Heres-muted transition-colors group-hover:text-Heres-accent" aria-hidden />
                <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span>Send funds</span>
                  <span className="text-[10px] font-normal uppercase tracking-wider text-Heres-muted">
                    SOL + tokens
                  </span>
                </span>
              </button>
            )}

            {embeddedWallet && (
              <button
                type="button"
                role="menuitem"
                disabled={exporting}
                onClick={handleExportWallet}
                className="group flex w-full items-center gap-2.5 border-t border-Heres-border px-4 py-3 text-left text-sm font-medium text-Heres-white transition-colors hover:bg-Heres-accent/10 hover:text-Heres-accent disabled:cursor-wait disabled:opacity-60"
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-Heres-accent" aria-hidden />
                ) : (
                  <KeyRound className="h-4 w-4 text-Heres-muted transition-colors group-hover:text-Heres-accent" aria-hidden />
                )}
                <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span>{exporting ? 'Opening export...' : 'Export wallet'}</span>
                  <span className="text-[10px] font-normal uppercase tracking-wider text-Heres-muted">
                    Private key
                  </span>
                </span>
              </button>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                logout()
              }}
              className="group flex w-full items-center gap-2.5 border-t border-Heres-border px-4 py-3 text-left text-sm font-medium text-Heres-white transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              <LogOut className="h-4 w-4 text-Heres-muted transition-colors group-hover:text-red-400" aria-hidden />
              Log out
            </button>
          </div>
        </div>
      )}

      {sendOpen && (
        <SendFundsDialog open wallet={wallet} onClose={() => setSendOpen(false)} />
      )}
    </div>
  )
}

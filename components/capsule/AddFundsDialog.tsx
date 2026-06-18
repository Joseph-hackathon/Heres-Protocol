'use client'

import { useEffect, useState } from 'react'
import { BN } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import type { HeresWallet } from '@/types/wallet'
import { deposit } from '@/lib/solana'
import { normalizeTxError } from '@/lib/errors'
import { maskAddress } from '@/lib/format'
import { getSolanaConnection } from '@/config/solana'
import { Modal, Button, Field, Input, useToast } from '@/components/ui'

export interface AddFundsDialogProps {
  open: boolean
  onClose: () => void
  owner: PublicKey
  wallet: HeresWallet
  /** 'sol' for a native-SOL capsule, 'spl' for a fungible token capsule. */
  assetKind: 'sol' | 'spl'
  /** Required for assetKind 'spl' - the token mint to deposit. */
  mint?: PublicKey
  /** Display symbol for the amount unit (e.g. SOL or the token symbol). */
  symbol: string
  onDeposited: () => Promise<void>
}

/**
 * Convert a human decimal string to integer base units. Returns null for anything that is not a
 * clean non-negative decimal (mirrors the strict on-chain amount parsing - no "1e3", signs, blanks).
 */
function parseDecimalToBaseUnits(value: string, decimals: number): bigint | null {
  const raw = value.trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) return null
  const [intPart, fracPart = ''] = raw.split('.')
  if (fracPart.length > decimals) return null
  const padded = (intPart + fracPart.padEnd(decimals, '0')) || '0'
  const units = BigInt(padded)
  return units > 0n ? units : null
}

/**
 * Re-fund a capsule. The on-chain deposit instruction is repeatable, so an owner can top up an
 * active capsule any time - the vault holds native SOL plus one ATA per mint. This dialog handles a
 * single asset (the capsule's own SOL or token); decimals for SPL are read from the mint on open.
 */
export function AddFundsDialog({
  open,
  onClose,
  owner,
  wallet,
  assetKind,
  mint,
  symbol,
  onDeposited,
}: AddFundsDialogProps) {
  const { toast } = useToast()
  // The page remounts this dialog on open (via a key), so initial state is always fresh - no
  // reset-on-open effect needed.
  const [amount, setAmount] = useState('')
  const [decimals, setDecimals] = useState<number | null>(assetKind === 'sol' ? 9 : null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // For an SPL capsule, read the mint's decimals so the amount converts to base units correctly.
  useEffect(() => {
    if (!open || assetKind !== 'spl' || !mint) return
    let cancelled = false
    ;(async () => {
      try {
        const info = await getSolanaConnection().getParsedAccountInfo(mint)
        const parsed = (info.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)?.parsed
        const d = parsed?.info?.decimals
        if (!cancelled && typeof d === 'number') setDecimals(d)
      } catch {
        if (!cancelled) setError('Could not read the token mint. Try again.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, assetKind, mint])

  const handleDeposit = async () => {
    setError(null)
    if (decimals == null) {
      setError('Still reading the token mint. Try again in a moment.')
      return
    }
    const units = parseDecimalToBaseUnits(amount, decimals)
    if (units == null) {
      setError('Enter a valid amount greater than zero.')
      return
    }
    setSubmitting(true)
    try {
      const tx = await deposit(wallet, new BN(units.toString()), assetKind === 'spl' ? mint : undefined)
      toast({ message: `Added funds to your capsule. TX: ${maskAddress(tx)}`, variant: 'success' })
      await onDeposited()
      onClose()
    } catch (err: unknown) {
      const msg = normalizeTxError(err)
      setError(msg)
      toast({ message: msg, variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Funds">
      <p className="text-sm text-ash">
        Top up this capsule&apos;s vault. Deposits are repeatable, so you can add to an active capsule
        any time. Funds stay withdrawable by you until the capsule fires.
      </p>

      <div className="mt-5">
        <Field
          label={`Amount (${symbol})`}
          hint={assetKind === 'spl' && decimals == null ? 'Reading token details...' : undefined}
        >
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.0"
            autoFocus
          />
        </Field>
      </div>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleDeposit} loading={submitting} disabled={submitting}>
          Add Funds
        </Button>
      </div>
    </Modal>
  )
}

'use client'

import { useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import { recoverVault } from '@/lib/solana'
import { normalizeTxError } from '@/lib/errors'
import { maskAddress } from '@/lib/format'
import type { VaultAssets } from '@/hooks/queries/useCapsuleDetail'
import { Modal, Button, useToast } from '@/components/ui'

export interface WithdrawFundsDialogProps {
  open: boolean
  onClose: () => void
  owner: PublicKey
  wallet: WalletContextState
  assets: VaultAssets
  /** Symbol + mint of the capsule's primary asset, used to label the SPL rows nicely. */
  assetSymbol?: string
  assetMint?: string | null
  /** Refetch on-chain state after each successful withdraw (capsule + vault assets). */
  onWithdrawn: () => Promise<void>
}

const LAMPORTS_PER_SOL = 1_000_000_000

function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: 9 })
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString()
  const value = Number(amount) / 10 ** decimals
  return value.toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals, 9) })
}

/**
 * Withdraw funds out of the capsule vault. The vault can hold native SOL plus any number of SPL
 * mints, and the on-chain recover_vault pulls exactly ONE asset per call, so this lists every held
 * asset with its own withdraw action (plus a "withdraw all" that runs them back to back). Each asset
 * is its own transaction, so multi-asset withdraw prompts one wallet approval per asset.
 */
export function WithdrawFundsDialog({
  open,
  onClose,
  owner,
  wallet,
  assets,
  assetSymbol,
  assetMint,
  onWithdrawn,
}: WithdrawFundsDialogProps) {
  const { toast } = useToast()
  // Key of the asset currently withdrawing ('sol' | mint base58), or 'all' for the batch run.
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const labelForMint = (mint: PublicKey): string => {
    if (assetMint && mint.toBase58() === assetMint && assetSymbol) return assetSymbol
    return maskAddress(mint.toBase58())
  }

  const withdrawOne = async (mint: PublicKey | undefined, key: string): Promise<boolean> => {
    setError(null)
    setBusy(key)
    try {
      const tx = await recoverVault(wallet, owner, mint)
      toast({ message: `Withdrawn to your wallet. TX: ${maskAddress(tx)}`, variant: 'success' })
      await onWithdrawn()
      return true
    } catch (err: unknown) {
      const msg = normalizeTxError(err)
      setError(msg)
      toast({ message: msg, variant: 'error' })
      return false
    } finally {
      setBusy(null)
    }
  }

  const handleWithdrawAll = async () => {
    setError(null)
    setBusy('all')
    try {
      // SPL legs first, then the SOL leg - mirrors the distribute ordering.
      for (const t of assets.tokens) {
        const tx = await recoverVault(wallet, owner, t.mint)
        toast({ message: `Withdrew ${labelForMint(t.mint)}. TX: ${maskAddress(tx)}`, variant: 'success' })
      }
      if (assets.withdrawableSol > 0) {
        const tx = await recoverVault(wallet, owner, undefined)
        toast({ message: `Withdrew SOL. TX: ${maskAddress(tx)}`, variant: 'success' })
      }
      await onWithdrawn()
    } catch (err: unknown) {
      const msg = normalizeTxError(err)
      setError(msg)
      toast({ message: msg, variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const rowCount = (assets.withdrawableSol > 0 ? 1 : 0) + assets.tokens.length
  const anyBusy = busy !== null

  return (
    <Modal open={open} onClose={onClose} title="Withdraw Funds">
      <p className="text-sm text-ash">
        Pull assets out of this capsule back to your wallet. The capsule stays active and armed - you
        can re-fund it later. Each asset is withdrawn in its own transaction.
      </p>

      {rowCount === 0 ? (
        <div className="mt-5 rounded-lg border border-hair bg-card/60 p-4 text-center text-sm text-ash">
          No withdrawable funds in this capsule.
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-2">
          {assets.withdrawableSol > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-hair bg-card px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-vellum">SOL</p>
                <p className="font-mono text-xs text-ash tabular-nums">{formatSol(assets.withdrawableSol)} SOL</p>
              </div>
              <Button
                variant="danger"
                size="sm"
                disabled={anyBusy}
                loading={busy === 'sol'}
                onClick={() => withdrawOne(undefined, 'sol')}
              >
                Withdraw
              </Button>
            </div>
          )}
          {assets.tokens.map((t) => {
            const key = t.mint.toBase58()
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-lg border border-hair bg-card px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-vellum">{labelForMint(t.mint)}</p>
                  <p className="font-mono text-xs text-ash tabular-nums">
                    {formatTokenAmount(t.amount, t.decimals)}
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={anyBusy}
                  loading={busy === key}
                  onClick={() => withdrawOne(t.mint, key)}
                >
                  Withdraw
                </Button>
              </div>
            )
          })}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose} disabled={anyBusy}>
          Close
        </Button>
        {rowCount > 1 && (
          <Button variant="danger" onClick={handleWithdrawAll} loading={busy === 'all'} disabled={anyBusy}>
            Withdraw all
          </Button>
        )}
      </div>
    </Modal>
  )
}

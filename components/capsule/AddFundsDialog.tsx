'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BN } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import type { HeresWallet } from '@/types/wallet'
import { deposit } from '@/lib/solana'
import { normalizeTxError } from '@/lib/errors'
import { maskAddress } from '@/lib/format'
import { getSolanaConnection } from '@/config/solana'
import { getCapsuleFundingAssets, type CapsuleFundingAsset } from '@/lib/capsule-funding'
import { formatTransferAmount, parseTransferAmount } from '@/lib/transfer-amount'
import { queryKeys } from '@/lib/query/keys'
import { Modal, Button, Field, Input, Select, useToast } from '@/components/ui'

export interface AddFundsDialogProps {
  open: boolean
  onClose: () => void
  owner: PublicKey
  wallet: HeresWallet
  /** Preferred asset when the dialog opens. The owner can select any other fungible wallet asset. */
  assetKind: 'sol' | 'spl'
  /** Preferred mint for an SPL capsule. */
  mint?: PublicKey
  /** Display symbol for the preferred asset. Other mints use their shortened address. */
  symbol: string
  onDeposited: () => Promise<void>
}

function assetLabel(asset: CapsuleFundingAsset, preferredMint?: PublicKey, preferredSymbol?: string): string {
  if (asset.kind === 'sol') return 'SOL'
  if (preferredMint?.equals(asset.mint) && preferredSymbol) return preferredSymbol
  return `Token ${maskAddress(asset.mint.toBase58())}`
}

function compactBalance(asset: CapsuleFundingAsset): string {
  const exact = formatTransferAmount(asset.balance, asset.decimals)
  const [whole, fraction] = exact.split('.')
  if (!fraction || fraction.length <= 6) return exact
  return `${whole}.${fraction.slice(0, 6)}...`
}

/**
 * Re-fund a capsule. The on-chain deposit instruction is repeatable, so an owner can top up an
 * active capsule any time. The vault holds native SOL plus one ATA per mint, and all fungible mints
 * use the capsule's existing beneficiary percentages at settlement.
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
  const queryClient = useQueryClient()
  // The page remounts this dialog on open (via a key), so initial state is always fresh - no
  // reset-on-open effect needed.
  const preferredAssetId = assetKind === 'spl' && mint ? mint.toBase58() : 'sol'
  const [assetId, setAssetId] = useState(preferredAssetId)
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const assetsQuery = useQuery({
    queryKey: [...queryKeys.wallet.all, 'capsule-funding-assets', owner.toBase58()],
    enabled: open && wallet.publicKey?.equals(owner) === true,
    staleTime: 10_000,
    queryFn: () => getCapsuleFundingAssets(getSolanaConnection(), owner),
  })
  const assets = useMemo(() => assetsQuery.data ?? [], [assetsQuery.data])
  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === assetId) ?? assets.find((asset) => asset.id === 'sol') ?? null,
    [assetId, assets]
  )
  const selectedLabel = selectedAsset ? assetLabel(selectedAsset, mint, symbol) : 'asset'

  const handleMax = () => {
    if (!selectedAsset || selectedAsset.kind === 'sol') return
    setAmount(formatTransferAmount(selectedAsset.balance, selectedAsset.decimals))
    setError(null)
  }

  const handleDeposit = async () => {
    setError(null)
    if (!wallet.publicKey?.equals(owner)) {
      setError('Connect the capsule owner wallet to add assets.')
      return
    }
    if (!selectedAsset) {
      setError('Wallet balances are still loading. Try again in a moment.')
      return
    }
    const units = parseTransferAmount(amount, selectedAsset.decimals)
    if (units == null) {
      setError(`Enter a positive amount with no more than ${selectedAsset.decimals} decimal places.`)
      return
    }
    if (units > selectedAsset.balance) {
      setError(`The amount exceeds your ${selectedLabel} balance.`)
      return
    }
    if (selectedAsset.kind === 'sol' && units === selectedAsset.balance) {
      setError('Leave some SOL in your wallet for network fees.')
      return
    }
    setSubmitting(true)
    try {
      const depositMint = selectedAsset.kind === 'spl' ? selectedAsset.mint : undefined
      const tx = await deposit(wallet, new BN(units.toString()), depositMint)
      toast({ message: `Added ${selectedLabel} to your capsule. TX: ${maskAddress(tx)}`, variant: 'success' })
      await onDeposited()
      await queryClient.invalidateQueries({ queryKey: queryKeys.wallet.all })
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
    <Modal open={open} onClose={onClose} title="Add assets" className="max-w-lg">
      <p className="text-sm leading-relaxed text-ash">
        Add SOL or any fungible token in this wallet. Every token mint uses the capsule&apos;s existing
        beneficiary split when distribution begins.
      </p>

      <div className="mt-4 rounded-xl border border-brand/20 bg-brand/[0.06] px-4 py-3">
        <p className="text-xs leading-relaxed text-ash">
          NFTs are not listed here because each NFT needs a recipient assignment sealed during
          capsule creation.
        </p>
      </div>

      <div className="mt-5 space-y-4">
        <Field
          label="Asset"
          hint={selectedAsset ? `Available: ${compactBalance(selectedAsset)} ${selectedLabel}` : undefined}
        >
          <Select
            value={selectedAsset?.id ?? assetId}
            disabled={assetsQuery.isLoading || assets.length === 0}
            onChange={(event) => {
              setAssetId(event.target.value)
              setAmount('')
              setError(null)
            }}
          >
            {assets.length === 0 ? (
              <option value="sol">Reading wallet assets...</option>
            ) : assets.map((asset) => {
              const label = assetLabel(asset, mint, symbol)
              return (
                <option key={asset.id} value={asset.id}>
                  {label} - {compactBalance(asset)}
                </option>
              )
            })}
          </Select>
        </Field>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="capsule-funding-amount" className="text-sm font-medium text-vellum">
              Amount {selectedAsset ? `(${selectedLabel})` : ''}
            </label>
            {selectedAsset?.kind === 'spl' && (
              <button
                type="button"
                onClick={handleMax}
                className="text-xs font-semibold uppercase tracking-wider text-brand transition-opacity hover:opacity-75"
              >
                Max
              </button>
            )}
          </div>
          <Input
            id="capsule-funding-amount"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value)
              if (error) setError(null)
            }}
            inputMode="decimal"
            placeholder="0.0"
            autoComplete="off"
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'capsule-funding-error' : undefined}
          />
          {error && (
            <p id="capsule-funding-error" role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      </div>

      {assetsQuery.isError && (
        <p role="alert" className="mt-4 text-sm text-danger">
          Could not read this wallet&apos;s assets. Close the dialog and try again.
        </p>
      )}

      <p className="mt-4 text-xs leading-relaxed text-ash">
        Assets remain withdrawable until the capsule fires. Adding a new token mint may also require
        a small amount of SOL to create its vault token account.
      </p>

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleDeposit}
          loading={submitting}
          disabled={submitting || assetsQuery.isLoading || !selectedAsset}
        >
          Add {selectedAsset?.kind === 'spl' ? 'Token' : 'SOL'}
        </Button>
      </div>
    </Modal>
  )
}

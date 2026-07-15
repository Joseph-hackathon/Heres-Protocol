'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BN } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import type { HeresWallet } from '@/types/wallet'
import { deposit } from '@/lib/solana'
import { normalizeTxError } from '@/lib/errors'
import { maskAddress } from '@/lib/format'
import { getSolanaConnection } from '@/config/solana'
import { getVaultTokenAccounts, TOKEN_2022_PROGRAM_ID } from '@/lib/spl'
import { decimalAmountString, firstError } from '@/lib/schemas'
import { Modal, Button, Field, Input, Select, useToast } from '@/components/ui'
import { useSolBalance } from '@/hooks/queries/useSolBalance'
import { queryKeys } from '@/lib/query/keys'
import {
  SOL_ASSET_KEY,
  formatBaseUnits,
  parseDecimalToBaseUnits,
  type WalletFungibleAsset,
} from '@/lib/fungible-assets'

export interface AddFundsDialogProps {
  open: boolean
  onClose: () => void
  owner: PublicKey
  wallet: HeresWallet
  onDeposited: () => Promise<void>
}

/**
 * Re-fund a capsule. The on-chain deposit instruction is repeatable, so an owner can top up an
 * active capsule any time - the vault holds native SOL plus one ATA per mint. The owner can choose
 * any fungible asset currently held by the connected wallet, including a mint not yet in the vault.
 */
export function AddFundsDialog({
  open,
  onClose,
  owner,
  wallet,
  onDeposited,
}: AddFundsDialogProps) {
  const { toast } = useToast()
  // The page remounts this dialog on open (via a key), so initial state is always fresh - no
  // reset-on-open effect needed.
  const [amount, setAmount] = useState('')
  const [selectedAssetKey, setSelectedAssetKey] = useState(SOL_ASSET_KEY)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const solBalance = useSolBalance(owner)
  const tokensQuery = useQuery({
    queryKey: queryKeys.wallet.tokens(owner.toBase58()),
    enabled: open,
    staleTime: 10_000,
    retry: 1,
    queryFn: async (): Promise<WalletFungibleAsset[]> => {
      const accounts = await getVaultTokenAccounts(getSolanaConnection(), owner)
      return accounts
        .filter((token) => token.amount > 0n && !(token.decimals === 0 && token.amount === 1n))
        .map((token) => ({
          key: token.mint.toBase58(),
          mint: token.mint.toBase58(),
          decimals: token.decimals,
          symbol: maskAddress(token.mint.toBase58()),
          balanceUi: Number(token.amount) / 10 ** token.decimals,
          balanceBaseUnits: token.amount,
          tokenProgram: token.tokenProgram.toBase58(),
        }))
        .sort((a, b) => (b.balanceUi ?? 0) - (a.balanceUi ?? 0))
    },
  })
  const assets: WalletFungibleAsset[] = [
    {
      key: SOL_ASSET_KEY,
      mint: null,
      decimals: 9,
      symbol: 'SOL',
      balanceUi: solBalance.lamports == null ? null : solBalance.lamports / 1_000_000_000,
      balanceBaseUnits: solBalance.lamports == null ? null : BigInt(solBalance.lamports),
      tokenProgram: null,
    },
    ...(tokensQuery.data ?? []),
  ]
  const selectedAsset = assets.find((asset) => asset.key === selectedAssetKey) ?? assets[0]

  const handleDeposit = async () => {
    setError(null)
    // Format + positivity via the shared schema (one definition of "valid amount" app-wide); the
    // base-unit conversion below additionally rejects more decimal places than the asset supports.
    const fmt = decimalAmountString.safeParse(amount)
    if (!fmt.success) {
      setError(firstError(fmt.error))
      return
    }
    const units = parseDecimalToBaseUnits(amount, selectedAsset.decimals)
    if (units == null) {
      setError(`Use no more than ${selectedAsset.decimals} decimal places.`)
      return
    }
    if (selectedAsset.balanceBaseUnits != null && units > selectedAsset.balanceBaseUnits) {
      setError(`Amount exceeds your ${selectedAsset.symbol} wallet balance.`)
      return
    }
    setSubmitting(true)
    try {
      const mint = selectedAsset.mint ? new PublicKey(selectedAsset.mint) : undefined
      const tx = await deposit(wallet, new BN(units.toString()), mint)
      toast({ message: `Added funds to your capsule. TX: ${maskAddress(tx)}`, variant: 'success' })
      // The transaction is already confirmed at this point. A flaky follow-up RPC refresh must not
      // turn a successful deposit into a false failure; stale queries can recover on the next poll.
      await Promise.allSettled([onDeposited(), tokensQuery.refetch(), solBalance.refetch()])
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
        Add SOL or any fungible token in your wallet. You can add a new mint or top up an existing
        one. Funds stay withdrawable until the capsule fires.
      </p>

      <div className="mt-5 space-y-4">
        <Field
          label="Asset"
          hint={tokensQuery.isFetching ? 'Scanning both Solana token programs...' : undefined}
          error={tokensQuery.isError ? 'Could not load wallet tokens. Retry the scan.' : undefined}
        >
          <Select
            value={selectedAsset.key}
            onChange={(event) => {
              setSelectedAssetKey(event.target.value)
              setAmount('')
              setError(null)
            }}
            disabled={submitting}
          >
            {assets.map((asset) => (
              <option key={asset.key} value={asset.key}>
                {asset.symbol}
                {asset.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58() ? ' (Token-2022)' : ''}
                {asset.balanceBaseUnits != null
                  ? ` - ${formatBaseUnits(asset.balanceBaseUnits, asset.decimals)} available`
                  : ''}
              </option>
            ))}
          </Select>
        </Field>
        {tokensQuery.isError && (
          <Button variant="secondary" size="sm" onClick={() => tokensQuery.refetch()} disabled={submitting}>
            Retry token scan
          </Button>
        )}
        <Field
          label={`Amount (${selectedAsset.symbol})`}
          hint={
            selectedAsset.balanceBaseUnits == null
              ? undefined
              : `Available: ${formatBaseUnits(selectedAsset.balanceBaseUnits, selectedAsset.decimals)} ${selectedAsset.symbol}`
          }
          error={error ?? undefined}
          required
        >
          <Input
            type="text"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              if (error) setError(null)
            }}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            className="font-mono tabular-nums"
          />
        </Field>
      </div>

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

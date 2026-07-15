'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PublicKey } from '@solana/web3.js'
import { CheckCircle2, ExternalLink, Send, ShieldCheck } from 'lucide-react'
import type { HeresWallet } from '@/types/wallet'
import { getSolanaConnection } from '@/config/solana'
import { getExplorerUrl, getNetworkDisplayLabel, SOLANA_CONFIG } from '@/constants'
import { normalizeTxError } from '@/lib/errors'
import { formatSol, maskAddress } from '@/lib/format'
import { queryKeys } from '@/lib/query/keys'
import { formatTransferAmount, parseTransferAmount } from '@/lib/transfer-amount'
import {
  buildWalletTransfer,
  estimateMaxSolTransfer,
  getWalletTransferAssets,
  sendWalletTransfer,
  simulateWalletTransfer,
  type WalletTransferAsset,
  type WalletTransferRequest,
} from '@/lib/wallet-transfer'
import { Button, Field, Input, Modal, Select, useToast } from '@/components/ui'

interface SendFundsDialogProps {
  open: boolean
  onClose: () => void
  wallet: HeresWallet
}

interface TransferPreview {
  request: WalletTransferRequest
  networkFeeLamports: number
  recipientAccountRentLamports: number
}

function assetName(asset: WalletTransferAsset): string {
  return asset.kind === 'sol' ? 'SOL' : `Token ${maskAddress(asset.mint.toBase58())}`
}

function compactBalance(asset: WalletTransferAsset): string {
  const exact = formatTransferAmount(asset.balance, asset.decimals)
  const [whole, fraction] = exact.split('.')
  if (!fraction || fraction.length <= 6) return exact
  return `${whole}.${fraction.slice(0, 6)}...`
}

export function SendFundsDialog({ open, onClose, wallet }: SendFundsDialogProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [assetId, setAssetId] = useState('sol')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [maxLoading, setMaxLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [preview, setPreview] = useState<TransferPreview | null>(null)
  const [signature, setSignature] = useState<string | null>(null)

  const publicKey = wallet.publicKey
  const assetsQuery = useQuery({
    queryKey: [...queryKeys.wallet.all, 'transfer-assets', publicKey?.toBase58() ?? ''],
    enabled: open && !!publicKey,
    staleTime: 10_000,
    queryFn: () => getWalletTransferAssets(getSolanaConnection(), publicKey!),
  })
  const assets = useMemo(() => assetsQuery.data ?? [], [assetsQuery.data])
  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === assetId) ?? assets[0] ?? null,
    [assetId, assets]
  )

  const clearResult = () => {
    if (error) setError(null)
    if (preview) setPreview(null)
  }

  const parseRecipient = (): PublicKey | null => {
    try {
      const parsed = new PublicKey(recipient.trim())
      if (publicKey?.equals(parsed)) {
        setError('The recipient must be a different wallet.')
        return null
      }
      return parsed
    } catch {
      setError('Enter a valid Solana recipient address.')
      return null
    }
  }

  const handleMax = async () => {
    if (!selectedAsset || !publicKey) return
    setError(null)
    if (selectedAsset.kind === 'spl') {
      setAmount(formatTransferAmount(selectedAsset.balance, selectedAsset.decimals))
      return
    }

    const recipientKey = parseRecipient()
    if (!recipientKey) return
    setMaxLoading(true)
    try {
      const max = await estimateMaxSolTransfer(getSolanaConnection(), publicKey, recipientKey)
      if (max <= 0n) throw new Error('There is not enough SOL to cover the network fee.')
      setAmount(formatTransferAmount(max, 9))
    } catch (err) {
      setError(normalizeTxError(err))
    } finally {
      setMaxLoading(false)
    }
  }

  const handleReview = async () => {
    setError(null)
    if (!publicKey || !selectedAsset) {
      setError('Wallet balances are still loading. Try again in a moment.')
      return
    }
    const recipientKey = parseRecipient()
    if (!recipientKey) return
    const units = parseTransferAmount(amount, selectedAsset.decimals)
    if (units == null) {
      setError(`Enter a positive amount with no more than ${selectedAsset.decimals} decimal places.`)
      return
    }
    if (units > selectedAsset.balance) {
      setError(`The amount exceeds your ${assetName(selectedAsset)} balance.`)
      return
    }

    const request: WalletTransferRequest = {
      sender: publicKey,
      recipient: recipientKey,
      amount: units,
      asset: selectedAsset,
    }
    setPreviewing(true)
    try {
      const quote = await buildWalletTransfer(getSolanaConnection(), request)
      await simulateWalletTransfer(getSolanaConnection(), quote)
      setPreview({
        request,
        networkFeeLamports: quote.networkFeeLamports,
        recipientAccountRentLamports: quote.recipientAccountRentLamports,
      })
    } catch (err) {
      setError(normalizeTxError(err))
    } finally {
      setPreviewing(false)
    }
  }

  const handleSend = async () => {
    if (!preview) return
    setError(null)
    setSending(true)
    try {
      const result = await sendWalletTransfer(getSolanaConnection(), wallet, preview.request)
      setSignature(result.signature)
      setPreview(null)
      await queryClient.invalidateQueries({ queryKey: queryKeys.wallet.all })
      toast({ message: `Funds sent. TX: ${maskAddress(result.signature)}`, variant: 'success' })
    } catch (err) {
      const message = normalizeTxError(err)
      setError(message)
      toast({ message, variant: 'error' })
    } finally {
      setSending(false)
    }
  }

  const handleClose = () => {
    if (!sending) onClose()
  }

  const transferAmount = preview
    ? formatTransferAmount(preview.request.amount, preview.request.asset.decimals)
    : ''
  const totalNetworkCost = preview
    ? preview.networkFeeLamports + preview.recipientAccountRentLamports
    : 0

  return (
    <Modal open={open} onClose={handleClose} title="Send funds" className="max-w-lg">
      {signature ? (
        <div className="py-2 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-brand/30 bg-brand/10">
            <CheckCircle2 className="h-7 w-7 text-brand" aria-hidden />
          </div>
          <h3 className="mt-4 font-serif text-2xl text-vellum">Transfer confirmed</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ash">
            The transaction was confirmed on {getNetworkDisplayLabel(SOLANA_CONFIG.NETWORK)}.
          </p>
          <a
            href={getExplorerUrl('tx', signature)}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-hair px-4 text-sm font-medium text-vellum transition-colors hover:border-brand/40 hover:text-brand"
          >
            View transaction <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
          <Button className="mt-6 w-full" onClick={handleClose}>Done</Button>
        </div>
      ) : preview ? (
        <div>
          <div className="flex items-start gap-3 rounded-xl border border-brand/20 bg-brand/[0.06] p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-vellum">Review before signing</p>
              <p className="mt-1 text-xs leading-relaxed text-ash">
                Transfers are irreversible. Confirm the recipient and amount carefully.
              </p>
            </div>
          </div>

          <dl className="mt-5 overflow-hidden rounded-xl border border-hair bg-surface/60 text-sm">
            <div className="flex items-center justify-between gap-4 border-b border-hair px-4 py-3">
              <dt className="text-ash">Network</dt>
              <dd className="font-medium text-vellum">{getNetworkDisplayLabel()}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-hair px-4 py-3">
              <dt className="text-ash">Recipient</dt>
              <dd className="font-mono text-xs text-vellum" title={preview.request.recipient.toBase58()}>
                {maskAddress(preview.request.recipient.toBase58(), { head: 8, tail: 8 })}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-hair px-4 py-3">
              <dt className="text-ash">Amount</dt>
              <dd className="font-semibold tabular-nums text-vellum">
                {transferAmount} {assetName(preview.request.asset)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-ash">Network cost</dt>
              <dd className="tabular-nums text-vellum">{formatSol(totalNetworkCost, 6)} SOL</dd>
            </div>
          </dl>
          {preview.recipientAccountRentLamports > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-ash">
              Network cost includes {formatSol(preview.recipientAccountRentLamports, 6)} SOL to create
              the recipient&apos;s token account.
            </p>
          )}
          {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}

          <div className="mt-6 flex gap-3">
            <Button variant="ghost" className="flex-1" disabled={sending} onClick={() => { setPreview(null); setError(null) }}>
              Back
            </Button>
            <Button className="flex-1" loading={sending} onClick={handleSend}>
              Send now
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm leading-relaxed text-ash">
            Transfer SOL or a token from this Privy wallet on {getNetworkDisplayLabel()}.
          </p>

          <div className="mt-5 space-y-4">
            <Field
              label="Asset"
              hint={assetsQuery.isLoading ? 'Reading wallet balances...' : selectedAsset ? `Available: ${compactBalance(selectedAsset)} ${assetName(selectedAsset)}` : undefined}
            >
              <Select
                value={selectedAsset?.id ?? assetId}
                disabled={assetsQuery.isLoading || assets.length === 0}
                onChange={(event) => {
                  setAssetId(event.target.value)
                  setAmount('')
                  clearResult()
                }}
              >
                {assets.length === 0 ? (
                  <option value="sol">Loading assets...</option>
                ) : assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {assetName(asset)} - {compactBalance(asset)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Recipient address" required>
              <Input
                value={recipient}
                onChange={(event) => { setRecipient(event.target.value); clearResult() }}
                placeholder="Solana wallet address"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                autoFocus
              />
            </Field>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="send-wallet-amount" className="text-sm font-medium text-vellum">
                  Amount {selectedAsset ? `(${assetName(selectedAsset)})` : ''}
                </label>
                <button
                  type="button"
                  onClick={handleMax}
                  disabled={!selectedAsset || maxLoading}
                  className="text-xs font-semibold uppercase tracking-wider text-brand transition-opacity hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {maxLoading ? 'Calculating...' : 'Max'}
                </button>
              </div>
              <Input
                id="send-wallet-amount"
                value={amount}
                onChange={(event) => { setAmount(event.target.value); clearResult() }}
                inputMode="decimal"
                placeholder="0.0"
                autoComplete="off"
              />
            </div>
          </div>

          {assetsQuery.isError && (
            <p role="alert" className="mt-4 text-sm text-danger">Could not load wallet assets. Try reopening the menu.</p>
          )}
          {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}

          <div className="mt-6 flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={handleClose} disabled={previewing}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              loading={previewing}
              disabled={!selectedAsset || assetsQuery.isLoading}
              onClick={handleReview}
            >
              <Send className="h-4 w-4" aria-hidden />
              Review transfer
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

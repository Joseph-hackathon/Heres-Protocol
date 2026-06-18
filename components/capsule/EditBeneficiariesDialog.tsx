'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { PublicKey } from '@solana/web3.js'
import type { HeresWallet } from '@/types/wallet'
import { updateIntent } from '@/lib/solana'
import { getOrMintTeeToken } from '@/lib/tee'
import { normalizeTxError } from '@/lib/errors'
import { maskAddress } from '@/lib/format'
import { isValidSolanaAddress } from '@/config/solana'
import type { OnChainBeneficiary } from '@/types'
import { Modal, Button, Field, Input, useToast } from '@/components/ui'

export interface EditBeneficiariesDialogProps {
  open: boolean
  onClose: () => void
  owner: PublicKey
  wallet: HeresWallet
  /** The current on-chain beneficiary list to prefill (must be revealed first). */
  current: OnChainBeneficiary[]
  onUpdated: () => Promise<void>
}

interface Row {
  address: string
  /** Share as a percentage string (e.g. "50" = 50%). */
  share: string
}

const MAX_BENEFICIARIES = 8

function rowsFromCurrent(current: OnChainBeneficiary[]): Row[] {
  if (current.length === 0) return [{ address: '', share: '100' }]
  return current.map((b) => ({
    address: b.pubkey.toBase58(),
    share: String(b.shareBps / 100),
  }))
}

/** Percentage string -> basis points (round to the nearest bp). Returns null for invalid input. */
function pctToBps(share: string): number | null {
  const raw = share.trim()
  if (!/^\d+(\.\d+)?$/.test(raw)) return null
  const bps = Math.round(parseFloat(raw) * 100)
  return bps > 0 ? bps : null
}

/**
 * Edit the private beneficiary list (on-chain update_intent). This is a FULL replace - the list you
 * save becomes the entire new set. Shares must total 100% and there can be at most 8 entries. The
 * write is routed through the TEE while the BeneficiarySet is delegated, so the updated list never
 * touches public base-layer history; it reuses the owner's TEE auth token (the same one the "reveal"
 * flow mints).
 */
export function EditBeneficiariesDialog({
  open,
  onClose,
  owner,
  wallet,
  current,
  onUpdated,
}: EditBeneficiariesDialogProps) {
  const { toast } = useToast()
  // The page remounts this dialog on open (via a key), so the useState initializer below seeds the
  // rows from the current list on every open - no reset-on-open effect needed.
  const [rows, setRows] = useState<Row[]>(() => rowsFromCurrent(current))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateRow = (index: number, key: keyof Row, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)))
  }
  const addRow = () => setRows((prev) => [...prev, { address: '', share: '' }])
  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index))

  // Live validation summary.
  const bpsList = rows.map((r) => pctToBps(r.share))
  const totalBps = bpsList.reduce((sum: number, b) => sum + (b ?? 0), 0)
  const totalPct = totalBps / 100
  const addressErrors = rows.map((r) => Boolean(r.address.trim()) && !isValidSolanaAddress(r.address.trim()))

  const handleSave = async () => {
    setError(null)
    if (rows.length === 0 || rows.length > MAX_BENEFICIARIES) {
      setError(`Set between 1 and ${MAX_BENEFICIARIES} beneficiaries.`)
      return
    }
    const beneficiaries: OnChainBeneficiary[] = []
    for (let i = 0; i < rows.length; i++) {
      const addr = rows[i].address.trim()
      if (!isValidSolanaAddress(addr)) {
        setError(`Beneficiary ${i + 1} has an invalid Solana address.`)
        return
      }
      const bps = bpsList[i]
      if (bps == null) {
        setError(`Beneficiary ${i + 1} needs a share greater than zero.`)
        return
      }
      beneficiaries.push({ pubkey: new PublicKey(addr), shareBps: bps })
    }
    if (totalBps !== 10000) {
      setError(`Shares must total exactly 100% (currently ${totalPct}%).`)
      return
    }

    setSubmitting(true)
    try {
      // Reuse / mint the owner's TEE token so the update routes into the enclave while delegated.
      const token = await getOrMintTeeToken(wallet)
      const tx = await updateIntent(wallet, beneficiaries, token)
      toast({ message: `Beneficiaries updated. TX: ${maskAddress(tx)}`, variant: 'success' })
      await onUpdated()
      onClose()
    } catch (err: unknown) {
      const msg = normalizeTxError(err)
      setError(msg)
      toast({ message: msg, variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const totalOk = totalBps === 10000

  return (
    <Modal open={open} onClose={onClose} title="Edit Beneficiaries" className="max-w-lg">
      <p className="text-sm text-ash">
        Replace this capsule&apos;s beneficiary list. Shares must total 100% and you can set up to{' '}
        {MAX_BENEFICIARIES}. While the capsule is private, the update is written inside the TEE and is
        not exposed on the public chain.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {rows.map((row, i) => (
          <div key={i} className="flex items-start gap-2">
            <Field
              label={`Beneficiary ${i + 1}`}
              error={addressErrors[i] ? 'Invalid Solana address' : undefined}
              className="min-w-0 flex-1"
            >
              <Input
                value={row.address}
                onChange={(e) => updateRow(i, 'address', e.target.value.trim())}
                placeholder="Recipient wallet address"
              />
            </Field>
            <Field label="Share %" className="w-24 shrink-0">
              <Input
                value={row.share}
                onChange={(e) => updateRow(i, 'share', e.target.value)}
                inputMode="decimal"
                placeholder="0"
                aria-label={`Share for beneficiary ${i + 1}`}
              />
            </Field>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label={`Remove beneficiary ${i + 1}`}
                className="mt-7 shrink-0 rounded-lg border border-hair p-2 text-danger transition-colors hover:bg-danger/10"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        {rows.length < MAX_BENEFICIARIES ? (
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add beneficiary
          </button>
        ) : (
          <span className="text-xs text-ash">Maximum {MAX_BENEFICIARIES} beneficiaries</span>
        )}
        <span className={`text-sm font-semibold tabular-nums ${totalOk ? 'text-brand' : 'text-danger'}`}>
          Total: {totalPct}%
        </span>
      </div>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} loading={submitting} disabled={submitting || !totalOk}>
          Save Beneficiaries
        </Button>
      </div>
    </Modal>
  )
}

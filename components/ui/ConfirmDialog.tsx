'use client'

import { useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { Input } from './Input'

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
  /** Require typing this exact string to enable confirm (destructive guard). */
  typedConfirm?: string
  loading?: boolean
}

/**
 * Confirmation dialog built on Modal. For irreversible actions, pass
 * `typedConfirm` to force the user to type a phrase before Confirm enables.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  typedConfirm,
  loading,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  const needsTyping = Boolean(typedConfirm)
  const canConfirm = !needsTyping || typed.trim() === typedConfirm

  const handleClose = () => {
    setTyped('')
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      {description && <div className="text-sm text-ash">{description}</div>}
      {needsTyping && (
        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-xs text-ash">
            Type <span className="font-mono text-vellum">{typedConfirm}</span> to confirm
          </label>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={handleClose}>
          {cancelLabel}
        </Button>
        <Button
          variant={variant === 'danger' ? 'danger' : 'primary'}
          disabled={!canConfirm}
          loading={loading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

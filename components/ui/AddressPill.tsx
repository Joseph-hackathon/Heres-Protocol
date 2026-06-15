import { ExternalLink } from 'lucide-react'
import { maskAddress } from '@/lib/format'
import { getExplorerUrl } from '@/lib/explorer'
import { CopyButton } from './CopyButton'
import { cn } from './utils'

export interface AddressPillProps {
  address: string
  head?: number
  tail?: number
  /** Link the address to the Solana explorer (address or tx view). */
  explorer?: 'address' | 'tx' | false
  copy?: boolean
  className?: string
}

/**
 * Monospace truncated address with copy + optional explorer link. Replaces the
 * maskAddress + CopyButton pairs repeated across the pages.
 */
export function AddressPill({
  address,
  head = 4,
  tail = 4,
  explorer = false,
  copy = true,
  className,
}: AddressPillProps) {
  const masked = maskAddress(address, { head, tail })

  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-sm text-ash', className)}>
      {explorer ? (
        <a
          href={getExplorerUrl(explorer, address)}
          target="_blank"
          rel="noopener noreferrer"
          title={address}
          className="inline-flex items-center gap-1 transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded"
        >
          {masked}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : (
        <span title={address}>{masked}</span>
      )}
      {copy && <CopyButton value={address} />}
    </span>
  )
}

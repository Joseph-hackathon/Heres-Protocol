import { getNetworkDisplayLabel, SOLANA_CONFIG } from '@/constants'
import { cn } from '@/components/ui/utils'

/**
 * Honest network indicator. The app's cluster is fixed by SOLANA_CONFIG.NETWORK,
 * so this is a static badge, not a switcher. (The old dropdown only set local
 * state and never re-pointed the RPC.) Mainnet shows amber to flag live funds.
 */
export function NetworkBadge({ className }: { className?: string }) {
  const network = SOLANA_CONFIG.NETWORK
  const label = getNetworkDisplayLabel(network)
  const isMainnet = network === 'mainnet-beta'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-2xl border border-hair bg-black/20 px-3 py-2 text-sm font-medium',
        className
      )}
      title={`Connected to ${label}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', isMainnet ? 'bg-warn' : 'bg-brand')} aria-hidden />
      <span className="text-vellum">{label}</span>
    </span>
  )
}

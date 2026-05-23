'use client'

import { useMemo } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useCreateWallet as useCreateExtendedWallet } from '@privy-io/react-auth/extended-chains'

const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID)

function compactAddress(address: string) {
  if (address.length <= 14) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function PrivyConnectInner({ compact = false }: { compact?: boolean }) {
  const { ready, authenticated, user, login, logout, connectWallet } = usePrivy()
  const { wallets } = useWallets()
  const { createWallet } = useCreateExtendedWallet()
  const stellarWallets = useMemo(() => {
    const linkedAccounts = (user?.linkedAccounts || []) as Array<Record<string, any>>
    return linkedAccounts.filter((account) => (
      account.type === 'wallet' &&
      (account.chainType === 'stellar' || account.chain_type === 'stellar')
    ))
  }, [user?.linkedAccounts])
  const walletSummary = useMemo(() => {
    if (!wallets.length) return 'No wallets'
    return wallets
      .slice(0, 2)
      .map((wallet) => {
        const chainType = (wallet as unknown as { chainType?: string; chain_type?: string }).chainType ||
          (wallet as unknown as { chainType?: string; chain_type?: string }).chain_type ||
          'wallet'
        return `${chainType}:${compactAddress(wallet.address)}`
      })
      .join(' / ')
  }, [wallets])

  if (!ready) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-10 items-center rounded-2xl border border-Heres-border/60 bg-black/20 px-4 text-sm font-semibold text-Heres-muted"
      >
        Privy loading
      </button>
    )
  }

  if (!authenticated) {
    return (
      <button
        type="button"
        onClick={() => login()}
        className="inline-flex h-10 items-center rounded-2xl border border-Heres-accent/25 bg-Heres-surface px-4 text-sm font-semibold text-Heres-white transition-colors hover:border-Heres-accent/50 hover:bg-Heres-card"
      >
        Connect Privy
      </button>
    )
  }

  return (
    <div className={`flex ${compact ? 'w-full flex-col' : 'items-center'} gap-2`}>
      <button
        type="button"
        onClick={() => connectWallet()}
        className="inline-flex h-10 items-center rounded-2xl border border-Heres-accent/25 bg-Heres-accent/10 px-4 text-sm font-semibold text-Heres-accent transition-colors hover:bg-Heres-accent/15"
        title={walletSummary}
      >
        {compact ? walletSummary : user?.email?.address || walletSummary}
      </button>
      {stellarWallets.length === 0 && (
        <button
          type="button"
          onClick={() => createWallet({ chainType: 'stellar' })}
          className="inline-flex h-10 items-center rounded-2xl border border-Heres-border/60 bg-black/20 px-3 text-xs font-semibold text-Heres-white transition-colors hover:border-Heres-accent/30 hover:bg-Heres-card/60"
          title="Create a Privy Stellar Tier 2 wallet for XLM and Stellar issued assets."
        >
          Add Stellar
        </button>
      )}
      <button
        type="button"
        onClick={() => logout()}
        className="inline-flex h-10 items-center rounded-2xl border border-Heres-border/60 bg-black/20 px-3 text-xs font-semibold text-Heres-muted transition-colors hover:text-Heres-white"
      >
        Logout
      </button>
    </div>
  )
}

export function PrivyConnectButton({ compact = false }: { compact?: boolean }) {
  if (!privyEnabled) {
    return (
      <span
        className="inline-flex h-10 items-center rounded-2xl border border-Heres-border/60 bg-black/20 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-Heres-muted"
        title="Set NEXT_PUBLIC_PRIVY_APP_ID to enable Privy login and multi-chain wallet linking."
      >
        Privy off
      </span>
    )
  }

  return <PrivyConnectInner compact={compact} />
}

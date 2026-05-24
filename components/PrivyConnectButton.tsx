'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useCreateWallet as useCreateExtendedWallet } from '@privy-io/react-auth/extended-chains'

const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID)

type WalletAddressRow = {
  chain: 'Solana' | 'Stellar'
  address: string
}

function compactAddress(address: string) {
  if (address.length <= 14) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getChainType(input: Record<string, any>) {
  return input.chainType || input.chain_type || input.chain || ''
}

function getAddress(input: Record<string, any>) {
  return input.address || input.walletAddress || input.wallet_address || input.publicKey || input.public_key || ''
}

function getChainLabel(chainType: string): WalletAddressRow['chain'] {
  const normalized = chainType.toLowerCase()
  if (normalized.includes('solana')) return 'Solana'
  if (normalized.includes('stellar')) return 'Stellar'
  return 'Solana'
}

function PrivyConnectInner({ compact = false }: { compact?: boolean }) {
  const { ready, authenticated, user, login, logout, connectWallet } = usePrivy()
  const { wallets } = useWallets()
  const { createWallet } = useCreateExtendedWallet()
  const [profileOpen, setProfileOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const linkedWalletAccounts = useMemo(() => {
    const linkedAccounts = (user?.linkedAccounts || []) as Array<Record<string, any>>
    return linkedAccounts.filter((account) => (
      account.type === 'wallet' && getAddress(account)
    ))
  }, [user?.linkedAccounts])
  const addressRows = useMemo<WalletAddressRow[]>(() => {
    const seen = new Set<string>()
    const rows: WalletAddressRow[] = []

    const addRow = (chainType: string, address: string) => {
      const trimmed = address.trim()
      if (!trimmed || seen.has(trimmed)) return
      const chain = getChainLabel(chainType)
      if (!chainType.toLowerCase().includes('solana') && !chainType.toLowerCase().includes('stellar')) return
      seen.add(trimmed)
      rows.push({ chain, address: trimmed })
    }

    wallets.forEach((wallet) => {
      const walletRecord = wallet as unknown as Record<string, any>
      addRow(getChainType(walletRecord), wallet.address)
    })
    linkedWalletAccounts.forEach((account) => {
      addRow(getChainType(account), getAddress(account))
    })

    return rows.sort((a, b) => {
      const order = { Solana: 0, Stellar: 1 }
      return order[a.chain] - order[b.chain]
    })
  }, [linkedWalletAccounts, wallets])
  const stellarWallets = useMemo(
    () => addressRows.filter((row) => row.chain === 'Stellar'),
    [addressRows]
  )
  const walletSummary = useMemo(() => {
    if (!addressRows.length) return 'No wallet addresses'
    return addressRows
      .slice(0, compact ? 2 : 3)
      .map((row) => `${row.chain === 'Stellar' ? 'XLM' : row.chain}: ${compactAddress(row.address)}`)
      .join(' / ')
  }, [addressRows, compact])
  const walletLabel = addressRows.length ? walletSummary : 'Wallet Profile'

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!ready) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-10 items-center rounded-2xl border border-Heres-border/60 bg-black/20 px-4 text-sm font-semibold text-Heres-muted"
      >
        Wallet loading
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
        Connect Wallet
      </button>
    )
  }

  return (
    <div ref={popoverRef} className={`relative ${compact ? 'w-full' : 'inline-flex'}`}>
      <button
        type="button"
        onClick={() => setProfileOpen((open) => !open)}
        className={`${compact ? 'w-full justify-center' : ''} inline-flex h-10 items-center rounded-2xl border border-Heres-accent/25 bg-Heres-accent/10 px-4 text-sm font-semibold text-Heres-accent transition-colors hover:bg-Heres-accent/15`}
        title={walletSummary}
      >
        {walletLabel}
      </button>
      {profileOpen && (
        <div className={`${compact ? 'left-0 right-0' : 'right-0'} absolute top-full z-[80] mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-Heres-border/80 bg-Heres-navy/95 p-3 text-left shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl`}>
          <div className="border-b border-Heres-border/70 pb-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-Heres-muted">Wallet Profile</p>
            <p className="mt-1 truncate text-sm font-semibold text-Heres-white">
              {user?.email?.address || 'Privy account'}
            </p>
          </div>

          <div className="mt-3 space-y-2">
            {addressRows.length === 0 ? (
              <p className="rounded-xl border border-Heres-border/70 bg-black/20 px-3 py-3 text-xs text-Heres-muted">
                No wallet address is linked yet. Connect or create a wallet to continue.
              </p>
            ) : (
              addressRows.map((row) => (
                <div key={`${row.chain}:${row.address}`} className="rounded-xl border border-Heres-border/70 bg-black/20 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-Heres-accent">{row.chain}</span>
                    <span className="text-[11px] text-Heres-muted">{compactAddress(row.address)}</span>
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-Heres-white/85">{row.address}</p>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 grid gap-2 border-t border-Heres-border/70 pt-3">
            <button
              type="button"
              onClick={() => connectWallet()}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-Heres-accent/25 bg-Heres-accent/10 px-3 text-xs font-semibold text-Heres-accent transition-colors hover:bg-Heres-accent/15"
            >
              Connect Wallet
            </button>
            {stellarWallets.length === 0 && (
              <button
                type="button"
                onClick={() => createWallet({ chainType: 'stellar' })}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-Heres-border/60 bg-black/20 px-3 text-xs font-semibold text-Heres-white transition-colors hover:border-Heres-accent/30 hover:bg-Heres-card/60"
                title="Create a Privy Stellar Tier 2 wallet for XLM and Stellar issued assets."
              >
                Add Stellar Wallet
              </button>
            )}
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-Heres-border/60 bg-black/20 px-3 text-xs font-semibold text-Heres-muted transition-colors hover:text-Heres-white"
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function PrivyConnectButton({ compact = false }: { compact?: boolean }) {
  if (!privyEnabled) {
    return (
      <span
        className="inline-flex h-10 items-center rounded-2xl border border-Heres-border/60 bg-black/20 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-Heres-muted"
        title="Set NEXT_PUBLIC_PRIVY_APP_ID to enable Solana and Stellar wallet linking."
      >
        Wallet setup required
      </span>
    )
  }

  return <PrivyConnectInner compact={compact} />
}

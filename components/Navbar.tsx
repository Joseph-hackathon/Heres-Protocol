'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Menu, User, X, ChevronDown } from 'lucide-react'
import { SOLANA_CONFIG, getNetworkDisplayLabel } from '@/constants'
import { PrivyConnectButton } from '@/components/PrivyConnectButton'
import '@solana/wallet-adapter-react-ui/styles.css'

const WalletMultiButton = dynamic(
  () =>
    import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
)

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/create', label: 'Create Capsule' },
]

const personalLink = { href: '/capsules', label: 'My Capsule' }

const NETWORKS = [
  { id: 'devnet', label: 'Solana Devnet' },
  { id: 'testnet', label: 'Solana Testnet' },
  { id: 'mainnet-beta', label: 'Solana Mainnet' },
] as const

const isNetworkEnabled = (networkId: (typeof NETWORKS)[number]['id']) => networkId !== 'mainnet-beta'

export function Navbar() {
  const pathname = usePathname()
  const [networkOpen, setNetworkOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [selectedNetwork, setSelectedNetwork] = useState<(typeof NETWORKS)[number]>(
    NETWORKS.find((network) => network.id === SOLANA_CONFIG.NETWORK) ?? NETWORKS[0]
  )
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setNetworkOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const isActivePath = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <header className="nav-glass">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-3 pr-4 sm:px-6 sm:pr-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-4 lg:gap-8">
          <Link href="/" className="flex shrink-0 items-center gap-2 sm:gap-2.5">
            <Image src="/logo-white.png?v=3" alt="Heres" width={52} height={52} className="h-9 w-auto sm:h-11" priority unoptimized />
            <div className="min-w-0">
              <span className="block truncate text-lg font-black uppercase tracking-[0.08em] text-Heres-white sm:text-xl">Heres</span>
            </div>
          </Link>

          <nav className="hidden items-center gap-5 lg:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-[13px] font-medium transition-colors ${isActivePath(link.href)
                ? 'text-Heres-accent'
                : 'text-Heres-muted hover:text-Heres-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href={personalLink.href}
            className={`hidden items-center gap-2 rounded-2xl border px-3.5 py-2 text-sm font-medium transition-colors xl:inline-flex ${isActivePath(personalLink.href)
              ? 'border-Heres-accent/35 bg-Heres-accent/10 text-Heres-accent'
              : 'border-Heres-border/60 bg-black/20 text-Heres-muted hover:border-Heres-accent/20 hover:bg-Heres-card/60 hover:text-Heres-white'
              }`}
          >
            <User className="h-4 w-4" />
            {personalLink.label}
          </Link>
          {/* Mobile: hamburger top right (pr on container avoids clip) */}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-Heres-border/70 bg-black/25 text-white lg:hidden"
            aria-expanded={mobileOpen}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
          <div className="relative hidden sm:block" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setNetworkOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-2xl border border-Heres-border/60 bg-black/20 px-3 py-2 text-sm font-medium text-Heres-white transition-colors hover:border-Heres-accent/20 hover:bg-Heres-card/60"
              aria-expanded={networkOpen}
              aria-haspopup="listbox"
              aria-label="Select network"
            >
              <span className="text-Heres-accent">{getNetworkDisplayLabel(selectedNetwork.id)}</span>
              <ChevronDown className={`h-4 w-4 text-Heres-muted transition-transform ${networkOpen ? 'rotate-180' : ''}`} />
            </button>
            {networkOpen && (
              <ul
                role="listbox"
                className="absolute right-0 top-full z-50 mt-2 min-w-[200px] rounded-2xl border border-Heres-border/80 bg-Heres-navy/95 py-1 shadow-[0_16px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl"
              >
                {NETWORKS.map((net) => (
                  <li key={net.id} role="option" aria-selected={selectedNetwork.id === net.id}>
                    <button
                      type="button"
                      disabled={!isNetworkEnabled(net.id)}
                      onClick={() => {
                        if (!isNetworkEnabled(net.id)) return
                        setSelectedNetwork(net)
                        setNetworkOpen(false)
                      }}
                      className={`flex w-full items-center px-4 py-2.5 text-left text-sm transition-colors ${selectedNetwork.id === net.id
                        ? 'bg-Heres-accent/20 text-Heres-accent'
                        : 'text-Heres-white hover:bg-Heres-surface'
                        } ${!isNetworkEnabled(net.id) ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''}`}
                    >
                      {net.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="relative z-50 hidden items-center wallet-nav-trigger sm:flex">
            <WalletMultiButton className="!h-10 !rounded-2xl !border !border-Heres-accent/20 !bg-Heres-accent !px-4 !py-0 !text-sm !font-semibold !text-slate-950 transition-opacity hover:!border-Heres-accent/40 hover:!opacity-95 active:scale-95" />
          </div>
          <div className="relative z-50 hidden items-center sm:flex">
            <PrivyConnectButton />
          </div>
        </div>
      </div>

      {/* Mobile menu: extend toward bottom, height slightly cut so panel doesn't go full viewport */}
      {mobileOpen && (
        <div
          className="overflow-x-hidden border-t border-Heres-border/70 bg-Heres-navyDeep lg:hidden"
          style={{
            backgroundColor: 'var(--Heres-navy-deep)',
            minHeight: 'calc(100dvh - 4rem - env(safe-area-inset-top, 0px) - 25rem)',
          }}
        >
          <nav className="mx-auto max-w-7xl px-4 py-3 sm:px-6 min-w-0 overflow-hidden">
            <div className="px-4 pb-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-Heres-muted/80">Menu</p>
            </div>
            <ul className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`block rounded-xl px-4 py-3 text-sm font-medium transition-colors ${isActivePath(link.href)
                      ? 'bg-Heres-accent/15 text-Heres-accent'
                      : 'text-white hover:bg-Heres-card/60'
                      }`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href={personalLink.href}
                  className={`block rounded-xl px-4 py-3 text-sm font-medium transition-colors ${isActivePath(personalLink.href)
                    ? 'bg-Heres-accent/15 text-Heres-accent'
                    : 'text-white hover:bg-Heres-card/60'
                    }`}
                >
                  {personalLink.label}
                </Link>
              </li>
            </ul>
            <div className="mt-2 border-t border-Heres-border/70 pt-2">
              <p className="px-4 py-1 text-xs font-semibold uppercase tracking-wider text-slate-300">Network</p>
              <div className="space-y-1">
                {NETWORKS.map((net) => (
                  <button
                    key={net.id}
                    type="button"
                    disabled={!isNetworkEnabled(net.id)}
                    onClick={() => {
                      if (!isNetworkEnabled(net.id)) return
                      setSelectedNetwork(net)
                    }}
                    className={`flex w-full items-center rounded-xl px-4 py-2.5 text-sm font-medium ${selectedNetwork.id === net.id ? 'bg-Heres-accent/20 text-white' : 'text-white hover:bg-Heres-card/60'
                      } ${!isNetworkEnabled(net.id) ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''}`}
                  >
                    {net.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mobile-menu-wallet-wrap mt-2 w-full min-w-0 overflow-hidden border-t border-Heres-border/70 px-6 pt-2 pb-3">
              <WalletMultiButton className="!h-11 !min-h-[44px] !w-full !max-w-full !min-w-0 !rounded-xl !bg-Heres-surface !px-4 !py-0 !text-sm !font-medium !text-white transition-opacity hover:!bg-Heres-card active:scale-95" />
              <div className="mt-2">
                <PrivyConnectButton compact />
              </div>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}

'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useWallet } from '@solana/wallet-adapter-react'
import { Menu, User, X } from 'lucide-react'
import { NetworkBadge } from '@/components/layout/NetworkBadge'
import { isAdminWallet } from '@/lib/admin'
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

export function Navbar() {
  const pathname = usePathname()
  const { publicKey } = useWallet()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Admin link is cosmetic visibility only; the explorer enforces access server-side.
  const links = useMemo(
    () => (isAdminWallet(publicKey ?? null) ? [...navLinks, { href: '/admin', label: 'Admin' }] : navLinks),
    [publicKey]
  )

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
          <Link href="/" aria-label="Heres home" className="flex shrink-0 items-center gap-[11px]">
            <Image src="/logo-white-icon.png" alt="" width={30} height={30} className="h-[30px] w-[30px]" priority unoptimized />
            <span className="font-serif text-[23px] leading-none text-vellum">
              Here<b className="font-normal text-Heres-accent">s</b>
            </span>
          </Link>

          <nav className="hidden items-center gap-5 lg:flex">
            {links.map((link) => (
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
          <NetworkBadge className="hidden sm:inline-flex" />
          <div className="relative z-50 hidden items-center wallet-nav-trigger sm:flex">
            <WalletMultiButton className="!h-10 !rounded-2xl !border !border-Heres-accent/20 !bg-Heres-accent !px-4 !py-0 !text-sm !font-semibold !text-slate-950 transition-opacity hover:!border-Heres-accent/40 hover:!opacity-95 active:scale-95" />
          </div>
        </div>
      </div>

      {/* Mobile menu: extend toward bottom, height slightly cut so panel doesn't go full viewport */}
      {mobileOpen && (
        <div
          className="overflow-x-hidden border-t border-Heres-border/70 bg-[#0a1022] lg:hidden"
          style={{
            backgroundColor: '#0f172a',
            minHeight: 'calc(100dvh - 4rem - env(safe-area-inset-top, 0px) - 25rem)',
          }}
        >
          <nav className="mx-auto max-w-7xl px-4 py-3 sm:px-6 min-w-0 overflow-hidden">
            <div className="px-4 pb-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-Heres-muted/80">Menu</p>
            </div>
            <ul className="flex flex-col gap-1">
              {links.map((link) => (
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
              <p className="px-4 py-1 text-xs font-semibold uppercase tracking-wider text-Heres-muted">Network</p>
              <div className="px-4 py-1">
                <NetworkBadge />
              </div>
            </div>
            <div className="mobile-menu-wallet-wrap mt-2 w-full min-w-0 overflow-hidden border-t border-Heres-border/70 px-6 pt-2 pb-3">
              <WalletMultiButton className="!h-11 !min-h-[44px] !w-full !max-w-full !min-w-0 !rounded-xl !bg-Heres-surface !px-4 !py-0 !text-sm !font-medium !text-white transition-opacity hover:!bg-Heres-card active:scale-95" />
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}

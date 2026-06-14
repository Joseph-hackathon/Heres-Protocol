'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Common footer for the entire site (landing + app), themed with the global
 * Quiet Ledger tokens. Faithful to the marketing footer; links are route-aware
 * so the section anchors work from app pages too (#how on landing, /#how off it).
 */
export function SiteFooter() {
  const pathname = usePathname()
  const base = pathname === '/' ? '' : '/'

  return (
    <footer
      role="contentinfo"
      className="relative z-[2] mx-auto w-full max-w-[1200px] px-[clamp(20px,5vw,64px)] pb-10 pt-[clamp(56px,8vw,88px)]"
    >
      <div className="grid grid-cols-1 items-start gap-9 min-[480px]:grid-cols-2 min-[820px]:grid-cols-[1.4fr_1fr_1fr_1fr] min-[820px]:gap-[clamp(28px,4vw,56px)]">
        <div className="min-[480px]:col-span-2 min-[820px]:col-span-1">
          <Link href="/" aria-label="Heres home" className="mb-[14px] inline-flex items-center gap-[11px] font-serif text-[26px] text-vellum">
            <Image src="/logo-white-icon.png" alt="" width={22} height={22} className="h-[22px] w-[22px]" unoptimized />
            <span>
              Here<b className="font-normal text-Heres-accent">s</b>
            </span>
          </Link>
          <p className="max-w-[30ch] text-[15px] text-ash">Private on-chain inheritance on Solana.</p>
        </div>

        <div>
          <h4 className="mb-4 font-grotesk text-[12px] font-semibold uppercase tracking-[0.1em] text-ash [font-variant:small-caps]">Product</h4>
          <ul className="flex list-none flex-col gap-[11px]">
            <li><Link className="text-[15px] text-vellum opacity-[0.82] transition hover:text-Heres-accent hover:opacity-100" href={`${base}#how`}>How it works</Link></li>
            <li><Link className="text-[15px] text-vellum opacity-[0.82] transition hover:text-Heres-accent hover:opacity-100" href={`${base}#privacy`}>Privacy</Link></li>
            <li><Link className="text-[15px] text-vellum opacity-[0.82] transition hover:text-Heres-accent hover:opacity-100" href={`${base}#usecases`}>Use cases</Link></li>
            <li><Link className="text-[15px] text-vellum opacity-[0.82] transition hover:text-Heres-accent hover:opacity-100" href="/create">Create</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="mb-4 font-grotesk text-[12px] font-semibold uppercase tracking-[0.1em] text-ash [font-variant:small-caps]">Resources</h4>
          <ul className="flex list-none flex-col gap-[11px]">
            <li><Link className="text-[15px] text-vellum opacity-[0.82] transition hover:text-Heres-accent hover:opacity-100" href="/dashboard">Dashboard</Link></li>
            <li><a className="text-[15px] text-vellum opacity-[0.82] transition hover:text-Heres-accent hover:opacity-100" href="https://doc.heresprotocol.com" target="_blank" rel="noopener noreferrer">Docs</a></li>
          </ul>
        </div>

        <div>
          <h4 className="mb-4 font-grotesk text-[12px] font-semibold uppercase tracking-[0.1em] text-ash [font-variant:small-caps]">Heres</h4>
          <ul className="flex list-none flex-col gap-[11px]">
            <li className="mt-[3px] flex items-center gap-[18px]">
              <a className="inline-flex items-center text-vellum opacity-[0.82] transition hover:text-Heres-accent hover:opacity-100" href="https://x.com/Heresprotocol" target="_blank" rel="noopener noreferrer" aria-label="Heres on X">
                <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a className="inline-flex items-center text-vellum opacity-[0.82] transition hover:text-Heres-accent hover:opacity-100" href="https://www.linkedin.com/company/heres-protocol/posts/?feedView=all" target="_blank" rel="noopener noreferrer" aria-label="Heres on LinkedIn">
                <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
                </svg>
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="mt-[clamp(40px,6vw,64px)] flex flex-wrap items-center justify-between gap-4 border-t border-hair pt-[26px]">
        <span className="text-[13px] text-ash [font-variant-numeric:tabular-nums]">Heres Protocol &middot; 2026</span>
        <a
          className="inline-flex items-center gap-[9px] rounded-[10px] border border-[color:var(--hair-strong)] bg-[rgb(234_238_246/0.02)] px-[14px] py-2 text-[13.5px] font-medium text-vellum transition hover:border-[color:var(--gold-soft)] hover:bg-[rgb(234_238_246/0.05)]"
          href="https://solana.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image src="/logos/solana.svg" alt="" width={20} height={18} className="h-[18px] w-[20px]" unoptimized />
          <span>Powered by Solana</span>
        </a>
      </div>
    </footer>
  )
}

import Image from 'next/image'
import { PrivyLoginButton } from '@/components/PrivyLoginButton'

export function MarketingNav() {
  return (
    <header className="nav" id="nav">
      <div className="wrap nav__inner">
        <a className="brand" href="#top" aria-label="Heres home">
          <Image src="/logo-white-icon.png" alt="" width={30} height={30} className="mark" unoptimized />
          <span>
            Here<b>s</b>
          </span>
        </a>
        <nav className="nav__links" aria-label="Primary">
          <a href="#how">How it works</a>
          <a href="#privacy">Privacy</a>
          <a href="#usecases">Use cases</a>
          <a href="https://doc.heresprotocol.com" target="_blank" rel="noopener noreferrer" aria-label="Documentation">
            Docs
          </a>
        </nav>
        <div className="nav__cta">
          {/* Wallet sign-in (Privy email -> embedded Solana wallet). Styled to match
              the landing's .btn--gold cyan pill so the nav reads on-brand. */}
          <PrivyLoginButton className="!rounded-[14px] !border-0 !px-[22px] !py-[13px] !text-[15px] !font-bold !bg-[#2DD4E8] !text-[#06080F] hover:!bg-[#5be1f2] active:!translate-y-px" />
        </div>
      </div>
    </header>
  )
}

import Image from 'next/image'
import Link from 'next/link'

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
          <Link className="btn btn--gold" href="/create">
            Create your capsule
          </Link>
        </div>
      </div>
    </header>
  )
}

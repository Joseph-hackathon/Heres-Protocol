import Image from 'next/image'
import Link from 'next/link'

export function MarketingFooter() {
  return (
    <footer className="foot wrap" role="contentinfo">
      <div className="foot__grid">
        <div className="foot__brand">
          <a className="brand" href="#top" aria-label="Heres home">
            <Image src="/logo-white-icon.png" alt="" width={22} height={22} className="mark" unoptimized />
            <span>
              Here<b>s</b>
            </span>
          </a>
          <p>Private on-chain inheritance on Solana.</p>
        </div>

        <div className="foot__col">
          <h4>Product</h4>
          <ul>
            <li>
              <a href="#how">How it works</a>
            </li>
            <li>
              <a href="#privacy">Privacy</a>
            </li>
            <li>
              <a href="#usecases">Use cases</a>
            </li>
            <li>
              <Link href="/create">Create</Link>
            </li>
          </ul>
        </div>

        <div className="foot__col">
          <h4>Resources</h4>
          <ul>
            <li>
              <a href="https://doc.heresprotocol.com" target="_blank" rel="noopener noreferrer">
                Docs
              </a>
            </li>
          </ul>
        </div>

        <div className="foot__col">
          <h4>Heres</h4>
          <ul>
            <li>
              <a href="#">About</a>
            </li>
            <li className="foot__socials">
              <a className="foot__social" href="https://x.com/Heresprotocol" target="_blank" rel="noopener noreferrer" aria-label="Heres on X">
                <svg className="foot__social-ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                className="foot__social"
                href="https://www.linkedin.com/company/heres-protocol/posts/?feedView=all"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Heres on LinkedIn"
              >
                <svg className="foot__social-ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
                </svg>
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="foot__bottom">
        <span className="foot__copy tnum">Heres Protocol · 2026</span>
        <a className="foot__solana" href="https://solana.com" target="_blank" rel="noopener noreferrer">
          <Image src="/logos/solana.svg" alt="" width={20} height={18} unoptimized />
          <span>Powered by Solana</span>
        </a>
      </div>
    </footer>
  )
}

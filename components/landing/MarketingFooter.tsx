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
            <li>
              <a href="https://github.com/HeresProtocol" target="_blank" rel="noopener noreferrer">
                GitHub
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
            <li>
              <a href="https://x.com/Heresprotocol" target="_blank" rel="noopener noreferrer">
                X
              </a>
            </li>
            <li>
              <a href="#">Contact</a>
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

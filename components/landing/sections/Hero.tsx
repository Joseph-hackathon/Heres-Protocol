import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { HeroStats } from './HeroStats'
import { FlipWord } from './FlipWord'
import { getHeroStats } from '@/lib/landing-stats'

export async function Hero() {
  const stats = await getHeroStats()

  return (
    <section className="hero wrap" aria-labelledby="hero-title">
      <div className="hero__grid">
        <div className="hero__intro">
          <span className="eyebrow hero__eyebrow reveal">Private on-chain inheritance, built on Solana</span>

          <h1 className="hero__title" id="hero-title">
            <span className="line">
              <span>
                <span className="hero__title-flip">
                  Your <FlipWord />
                </span>{' '}
                Executed when
              </span>
            </span>
            <span className="line">
              <span>you&apos;re silent</span>
            </span>
          </h1>

          <p className="hero__sub reveal">
            Set your terms once. If your wallet goes quiet, Heres settles them automatically.
          </p>

          <div className="hero__actions reveal">
            <Link className="btn btn--gold" href="/create">
              Create your capsule
            </Link>
            <a className="btn btn--ghost" href="#how">
              See how it works <ArrowRight className="ph-icon" aria-hidden />
            </a>
          </div>
        </div>

        <aside className="hero__panel reveal" aria-label="Protocol liveness and statistics">
          <div className="hero__panel-head">
            <span className="hero__panel-label">System status</span>
            <span className="hero__panel-updated">Updated now</span>
          </div>
          <div className="hero__panel-status">
            <i className="hero__panel-dot" aria-hidden />
            <span className="hero__panel-alive">Alive</span>
          </div>
          <canvas
            className="pulse-canvas"
            id="heroPulse"
            width={600}
            height={168}
            role="img"
            aria-label="A liveness pulse breathing on a four second cadence while the wallet is active"
          />
          <HeroStats initial={stats} />
          <div className="hero__panel-strip">
            <span className="hero__panel-strip-l">
              <i className="status-dot__i" aria-hidden /> Private. On-chain. Automatic.
            </span>
          </div>
        </aside>
      </div>
    </section>
  )
}

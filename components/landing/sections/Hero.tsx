import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export function Hero() {
  return (
    <section className="hero wrap" aria-labelledby="hero-title">
      <span className="eyebrow hero__eyebrow reveal">Private on-chain inheritance, built on Solana</span>

      <h1 className="hero__title" id="hero-title">
        <span className="line">
          <span>Your wallet goes silent.</span>
        </span>
        <span className="line">
          <span>
            Your <em>instructions</em> do not.
          </span>
        </span>
      </h1>

      <div className="hero__lower">
        <div>
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

        <aside className="hero__panel reveal" aria-label="Capsule liveness preview">
          <div className="hero__panel-head">
            <span className="hero__panel-label">Capsule status</span>
            <span className="status-dot">
              <i /> Alive
            </span>
          </div>
          <canvas
            className="pulse-canvas"
            id="heroPulse"
            width={600}
            height={168}
            role="img"
            aria-label="A liveness pulse breathing on a four second cadence while the wallet is active"
          />
          <div className="hero__panel-foot">
            <div>
              <div className="k">Last sign of life</div>
              <div className="v tnum">2 hours ago</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="k">Inactivity window</div>
              <div className="v tnum">180 days</div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}

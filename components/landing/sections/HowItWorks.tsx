import { Wallet, Activity, HeartHandshake } from 'lucide-react'

export function HowItWorks() {
  return (
    <section className="section wrap" id="how" aria-labelledby="how-heading">
      <div className="how__head reveal">
        <span className="eyebrow" style={{ marginBottom: 20, display: 'inline-flex' }}>
          How it works
        </span>
        <h2 className="h-sec" id="how-heading" style={{ maxWidth: '24ch' }}>
          Set it once.
          <br />
          It does the rest.
        </h2>
      </div>

      <div className="steps" style={{ position: 'relative' }}>
        <div className="how__line" aria-hidden="true" />

        <article className="step reveal">
          <span className="step__node" aria-hidden="true" />
          <div className="step__num tnum">01</div>
          <div className="step__body">
            <h3>Create your capsule</h3>
            <p>
              Choose your assets, set who receives them and in what share, and set your{' '}
              <b>inactivity window</b>: the longest stretch of wallet silence that should trigger
              distribution.
            </p>
            <span className="step__icon">
              <Wallet className="ph-icon" aria-hidden />
            </span>
          </div>
        </article>

        <article className="step reveal">
          <span className="step__node" aria-hidden="true" />
          <div className="step__num tnum">02</div>
          <div className="step__body">
            <h3>Heres watches your wallet</h3>
            <p>
              Every normal action, a swap, a transfer, anything, counts as a <b>sign of life</b>.
              You never have to check in. Your on-chain activity is the signal.
            </p>
            <span className="step__icon">
              <Activity className="ph-icon" aria-hidden />
            </span>
          </div>
        </article>

        <article className="step reveal">
          <span className="step__node" aria-hidden="true" />
          <div className="step__num tnum">03</div>
          <div className="step__body">
            <h3>Silence triggers settlement</h3>
            <p>
              If your wallet goes quiet past the window, your capsule <b>executes on Solana</b> and your
              people receive what you set aside, in their wallets, automatically. Reappear during the
              grace window and your capsule simply resets.
            </p>
            <span className="step__icon">
              <HeartHandshake className="ph-icon" aria-hidden />
            </span>
          </div>
        </article>
      </div>

      <div className="how__pulse-wrap reveal">
        <div className="how__pulse-head">
          <span className="t">Liveness over time</span>
          <span className="s" id="pulseState">
            Settling into silence
          </span>
        </div>
        <canvas
          className="how__pulse-canvas"
          id="howPulse"
          width={1000}
          height={128}
          role="img"
          aria-label="A liveness pulse that slows and flattens into a straight still line as silence passes the window"
        />
        <p className="how__pulse-cap">The pulse slows, flattens, and settles. Silence becomes truth.</p>
      </div>
    </section>
  )
}

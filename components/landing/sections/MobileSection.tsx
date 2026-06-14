import Link from 'next/link'
import { ArrowRight, User } from 'lucide-react'

export function MobileSection() {
  return (
    <section className="section wrap" aria-labelledby="mobile-heading">
      <div className="mobile__grid">
        <div className="mobile__head reveal">
          <span className="eyebrow" style={{ marginBottom: 20, display: 'inline-flex' }}>
            On your phone
          </span>
          <h2 id="mobile-heading">Set it up from your phone in under five minutes.</h2>
          <p className="mobile__body">
            Inheritance planning should not feel like deploying infrastructure. Heres is on{' '}
            <b>Solana Mobile and Seeker</b>, so setup works like your banking app. A few steps, done,
            and you can forget about it.
          </p>
          <div className="mobile__actions">
            <a className="btn btn--gold" href="https://seeker.solanamobile.com" target="_blank" rel="noopener noreferrer">
              Get it on Seeker
            </a>
            <Link className="btn btn--ghost" href="/create">
              Start on web <ArrowRight className="ph-icon" aria-hidden />
            </Link>
          </div>
        </div>

        <div
          className="phone reveal"
          role="img"
          aria-label="The Heres mobile app showing a capsule with a vault balance, three beneficiaries with their shares, and an alive status"
        >
          <span className="phone__notch" aria-hidden="true" />
          <div className="phone__screen">
            <div className="phone__top">
              <span className="phone__brand">
                Here<b>s</b>
              </span>
              <span className="phone__status">
                <i /> Alive
              </span>
            </div>
            <div className="phone__card">
              <div className="lbl">Capsule vault</div>
              <div className="val tnum">
                142.6 <small>SOL</small>
              </div>
              <div className="phone__meter" aria-hidden="true">
                <i />
              </div>
            </div>
            <div className="phone__card" style={{ marginBottom: 14 }}>
              <div className="lbl">Beneficiaries · sealed</div>
              <div className="phone__row">
                <span className="who">
                  <span className="av">
                    <User className="ph-icon" aria-hidden />
                  </span>{' '}
                  Beneficiary 1
                </span>
                <span className="pct tnum">50%</span>
              </div>
              <div className="phone__row">
                <span className="who">
                  <span className="av">
                    <User className="ph-icon" aria-hidden />
                  </span>{' '}
                  Beneficiary 2
                </span>
                <span className="pct tnum">30%</span>
              </div>
              <div className="phone__row">
                <span className="who">
                  <span className="av">
                    <User className="ph-icon" aria-hidden />
                  </span>{' '}
                  Beneficiary 3
                </span>
                <span className="pct tnum">20%</span>
              </div>
            </div>
            <div className="phone__btn">Capsule active · 180 days</div>
          </div>
        </div>
      </div>
    </section>
  )
}

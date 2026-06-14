import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export function FinalCTA() {
  return (
    <section className="section wrap final" aria-labelledby="final-heading">
      <div className="final__inner reveal">
        <h2 id="final-heading">Some things should not wait.</h2>
        <p>
          You already know who should receive what you have built. <b>The only question is whether your
          chain reflects that.</b> It can, in about five minutes.
        </p>
        <div className="final__actions">
          <Link className="btn btn--gold" href="/create">
            Create your capsule
          </Link>
          <a className="btn btn--ghost" href="#how">
            See how it works <ArrowRight className="ph-icon" aria-hidden />
          </a>
        </div>
        <span className="final__line" aria-hidden="true" />
      </div>
    </section>
  )
}

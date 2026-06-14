import { Users, KeyRound, Network } from 'lucide-react'

export function UseCases() {
  return (
    <section className="section wrap" id="usecases" aria-labelledby="uc-heading">
      <div className="uc__head reveal">
        <span className="eyebrow" style={{ marginBottom: 20, display: 'inline-flex' }}>
          Use cases
        </span>
        <h2 id="uc-heading">Who Heres is for.</h2>
      </div>

      <div className="uc__grid">
        <article className="uc reveal">
          <span className="uc__ic">
            <Users className="ph-icon" aria-hidden />
          </span>
          <h3>Families</h3>
          <p>
            Make sure your people receive what you built. Set a beneficiary split, and when the time
            comes your assets move to their wallets, no court, no one having to ask.
          </p>
        </article>

        <article className="uc reveal">
          <span className="uc__ic">
            <KeyRound className="ph-icon" aria-hidden />
          </span>
          <h3>Wallet backup</h3>
          <p>
            A silent failsafe for lost access. Name a recovery wallet or trusted contact. If you go
            dark, your capsule routes your assets to safety. Set it once and forget it.
          </p>
        </article>

        <article className="uc reveal">
          <span className="uc__ic">
            <Network className="ph-icon" aria-hidden />
          </span>
          <h3>Founders and long-term holders</h3>
          <p>
            Protocol-native succession for builders on Solana. If a treasury or vesting wallet should
            pass somewhere specific in an emergency, Heres carries that out automatically.
          </p>
        </article>
      </div>
    </section>
  )
}

import { ShieldCheck, Lock, Unlock, ArrowLeftRight, EyeOff, Eye, User, Cpu, AlertCircle, ArrowRight } from 'lucide-react'

export function Privacy() {
  return (
    <section className="section wrap privacy" id="privacy" aria-labelledby="privacy-heading">
      <div className="privacy__head reveal">
        <span className="eyebrow" style={{ marginBottom: 20, display: 'inline-flex' }}>
          Privacy
        </span>
        <h2 id="privacy-heading">Private while you are alive. Clear when it matters.</h2>
      </div>

      <div className="bento">
        <div className="cell cell--lede reveal">
          <div className="cell__eyebrow">
            <ShieldCheck className="ph-icon" aria-hidden /> The differentiator
          </div>
          <h3>Your beneficiaries are nobody&apos;s business but yours.</h3>
          <p style={{ marginTop: 'auto' }}>
            On most chains, putting beneficiaries in a contract makes them <b>public the instant you
            do it</b>. Heres keeps your beneficiary list sealed inside a Trusted Execution Environment.
            No one can read it while you are alive. It is revealed only at the moment of settlement,
            after your instructions have already been carried out.
          </p>
        </div>

        <div className="cell cell--state reveal">
          <div className="cell__eyebrow">
            <Lock className="ph-icon" aria-hidden /> While alive
          </div>
          <h3>Sealed</h3>
          <p>List encrypted in the TEE. Unreadable on-chain, even to us.</p>
        </div>

        <div className="cell cell--state reveal">
          <div className="cell__eyebrow">
            <Unlock className="ph-icon" aria-hidden /> At settlement
          </div>
          <h3>Revealed</h3>
          <p>Disclosed only once instructions have already executed.</p>
        </div>

        <div className="cell cell--diagram reveal">
          <div className="cell__eyebrow">
            <ArrowLeftRight className="ph-icon" aria-hidden /> Sealed while you are alive&nbsp; → &nbsp;Revealed at settlement
          </div>
          <div className="twostate">
            <div className="twostate__panel sealed">
              <div className="twostate__label">
                <EyeOff className="ph-icon" aria-hidden /> Sealed while you are alive
              </div>
              <div className="row">
                <span className="av">
                  <User className="ph-icon" aria-hidden />
                </span>
                <span className="bar" />
                <span className="bar amt" />
              </div>
              <div className="row">
                <span className="av">
                  <User className="ph-icon" aria-hidden />
                </span>
                <span className="bar" />
                <span className="bar amt" />
              </div>
              <div className="row">
                <span className="av">
                  <User className="ph-icon" aria-hidden />
                </span>
                <span className="bar" />
                <span className="bar amt" />
              </div>
            </div>
            <div className="twostate__arrow" aria-hidden="true">
              <ArrowRight className="ph-icon" aria-hidden />
            </div>
            <div className="twostate__panel revealed">
              <div className="twostate__label">
                <Eye className="ph-icon" aria-hidden /> Revealed at settlement
              </div>
              <div className="row">
                <span className="av">
                  <User className="ph-icon" aria-hidden />
                </span>
                <span className="name">Maria · family</span>
                <span className="share" style={{ marginLeft: 'auto' }}>
                  50%
                </span>
              </div>
              <div className="row">
                <span className="av">
                  <User className="ph-icon" aria-hidden />
                </span>
                <span className="name">Daniel · family</span>
                <span className="share" style={{ marginLeft: 'auto' }}>
                  30%
                </span>
              </div>
              <div className="row">
                <span className="av">
                  <User className="ph-icon" aria-hidden />
                </span>
                <span className="name">Recovery wallet</span>
                <span className="share" style={{ marginLeft: 'auto' }}>
                  20%
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="cell cell--tee reveal">
          <div className="cell__eyebrow">
            <Cpu className="ph-icon" aria-hidden /> Trusted Execution Environment
          </div>
          <h3>The vault keeps its own counsel.</h3>
          <p>The TEE computes the settlement and only then unseals the list. The reveal is a consequence of execution, never a precondition.</p>
        </div>

        <div className="cell cell--note reveal">
          <div className="cell__eyebrow">
            <AlertCircle className="ph-icon" aria-hidden /> The default elsewhere
          </div>
          <h3>On a public contract, your plan leaks on day one.</h3>
          <p>Anyone reading the chain sees who inherits what, while you are still very much alive.</p>
        </div>
      </div>
    </section>
  )
}

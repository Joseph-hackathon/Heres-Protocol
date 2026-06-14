export function Gap() {
  return (
    <section className="section wrap" aria-labelledby="gap-heading">
      <span className="eyebrow reveal" style={{ marginBottom: 34, display: 'inline-flex' }}>
        The gap
      </span>
      <div className="gap__grid">
        <h2 className="gap__heading reveal" id="gap-heading">
          Most crypto assets have no inheritance plan.
        </h2>
        <p className="gap__body reveal">
          If something happened to you today, where would your SOL and tokens go?{' '}
          <b>No chain answers that on its own.</b> Heres does, with one setup that runs silently
          until it needs to act.
        </p>
      </div>
    </section>
  )
}

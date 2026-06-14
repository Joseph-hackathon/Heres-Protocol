/**
 * Full-bleed background layers for the marketing landing.
 *
 * Pure markup (no interactivity here): a static CSS gradient field that is always
 * visible, a WebGL canvas the {@link LandingClient} effect paints the aurora into
 * (kept hidden until a successful first paint), plus grain and vignette. The
 * canvas degrades to the static field on WebGL failure, low-power mobile, or
 * prefers-reduced-motion.
 */
export function LandingBackground() {
  return (
    <>
      <div className="bg-static" aria-hidden="true" />
      <canvas id="bg-canvas" aria-hidden="true" />
      <div className="bg-grain" aria-hidden="true" />
      <div className="bg-vignette" aria-hidden="true" />
    </>
  )
}

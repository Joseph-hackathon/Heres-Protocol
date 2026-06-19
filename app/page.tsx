import type { Metadata } from 'next'
import '@/components/landing/landing.css'
import { LandingBackground } from '@/components/landing/LandingBackground'
import { LandingClient } from '@/components/landing/LandingClient'
import { MarketingNav } from '@/components/landing/MarketingNav'
import { MarketingFooter } from '@/components/landing/MarketingFooter'
import { Hero } from '@/components/landing/sections/Hero'
import { TrustStrip } from '@/components/landing/sections/TrustStrip'
import { Gap } from '@/components/landing/sections/Gap'
import { HowItWorks } from '@/components/landing/sections/HowItWorks'
import { Privacy } from '@/components/landing/sections/Privacy'
import { UseCases } from '@/components/landing/sections/UseCases'
import { FinalCTA } from '@/components/landing/sections/FinalCTA'

export const metadata: Metadata = {
  title: 'Heres - Private on-chain inheritance on Solana',
  description:
    'Set your beneficiaries, your assets, and your inactivity window once. If your wallet goes quiet past that window, Heres settles your instructions on Solana automatically. Private until it matters.',
}

// Regenerate the page (and its server-fetched hero stats) at most once an hour.
export const revalidate = 3600

// Marketing landing (Design 04 "Elevated"): a static, full-bleed page with its
// own chrome and a WebGL aurora background. The global Navbar/Footer are hidden
// on "/" by SiteChrome. Presentation lives in components/landing/*; the motion
// layer is the single client component LandingClient.
export default function HomePage() {
  return (
    <div className="lp">
      <LandingBackground />
      <MarketingNav />

      <main className="page" id="top">
        <Hero />
        <hr className="rule" />
        <TrustStrip />
        <hr className="rule" />
        <Gap />
        <hr className="rule" />
        <HowItWorks />
        <hr className="rule" />
        <Privacy />
        <hr className="rule" />
        <UseCases />
        <hr className="rule" />
        <FinalCTA />
      </main>

      <MarketingFooter />

      <LandingClient />
    </div>
  )
}

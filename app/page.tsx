import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Download, Shield, Smartphone } from 'lucide-react'
import { getDashboardSnapshot } from '@/lib/dashboard'

const partnerLogos = [
  { name: 'Colosseum', src: '/logos/colosseum-logo-white.svg', href: 'https://colosseum.com/', logoWidth: 122, wordmarkOnly: true },
  { name: 'MagicBlock', src: '/logos/magicblock.svg', href: 'https://www.magicblock.gg/' },
  { name: 'Solana', src: '/logos/solana.svg', href: 'https://solana.com/' },
  { name: 'Helius', src: '/logos/helius.svg', href: 'https://www.helius.dev/' },
  { name: 'Alchemy', src: '/logos/alchemy-logo.svg', href: 'https://www.alchemy.com/', logoWidth: 112, wordmarkOnly: true },
]

const featureCards = [
  {
    title: 'Create Capsule',
    description: 'Define beneficiary wallets, allocation rules, and inactivity conditions under two minutes.',
    href: '/create',
    cta: 'Create Capsule',
  },
  {
    title: 'Track Activity',
    description: 'Monitor wallet-level activity signals and capsule status from a single dashboard.',
    href: '/dashboard',
    cta: 'Open Dashboard',
  },
  {
    title: 'Mobile Demo',
    description: 'Run the seeker-native flow and sign extension actions directly from your mobile device.',
    href: 'https://seeker.solanamobile.com',
    cta: 'Download APK',
    external: true,
  },
]

const whyCards = [
  {
    index: '01',
    title: 'Your intent, executed when you want',
    description:
      'Leave instructions that run only when the time is right. No one can execute early. Your conditions stay yours until the moment time says execute.',
  },
  {
    index: '02',
    title: 'Privacy by design',
    description:
      'Your conditions stay private. Only the outcome is visible on-chain. No third party sees your rules. Just the result when silence becomes truth.',
  },
  {
    index: '03',
    title: "Set it once. It runs when you're silent.",
    description:
      'Define your intent once. No bridges, no middlemen. When your conditions are met, execution happens automatically, the way you wanted.',
  },
]

function PartnerBadge({
  name,
  src,
  href,
  logoWidth,
  wordmarkOnly,
}: {
  name: string
  src: string
  href: string
  logoWidth?: number
  wordmarkOnly?: boolean
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="partner-marquee-badge flex h-14 min-w-[176px] items-center justify-center gap-3 rounded-2xl px-5 py-3 transition-colors hover:border-Heres-accent/30 hover:bg-Heres-card/70"
    >
      <Image
        src={src}
        alt={name}
        width={logoWidth || 28}
        height={28}
        className={`${wordmarkOnly ? 'h-6 w-auto max-w-[122px]' : 'h-6 w-6'} object-contain`}
        unoptimized
      />
      {!wordmarkOnly && <span className="text-xs font-semibold uppercase tracking-[0.18em] text-Heres-white">{name}</span>}
    </a>
  )
}

function formatMetricCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatAssetAmount(value: number) {
  if (value >= 100) return value.toFixed(0)
  if (value >= 1) return value.toFixed(2)
  return value.toFixed(4)
}

function formatSolAmount(lamports: number) {
  return (lamports / 1_000_000_000).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: lamports >= 100_000_000_000 ? 0 : 2,
  })
}

async function getLandingStats() {
  try {
    const snapshot = await getDashboardSnapshot(false, true, false)
    const assetSummary = Object.entries(snapshot.summary.activeAssetTotals || {})
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1]) && entry[1] > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([symbol, amount]) => `${formatAssetAmount(amount)} ${symbol}`)
      .join(' · ')

    return {
      total: snapshot.summary.total,
      active: snapshot.summary.active,
      executed: snapshot.summary.executed,
      totalValueSecuredLamports: snapshot.summary.totalValueSecuredLamports,
      assetSummary: assetSummary || 'No active locked assets',
    }
  } catch {
    return {
      total: 0,
      active: 0,
      executed: 0,
      totalValueSecuredLamports: 0,
      assetSummary: 'Dashboard metrics syncing',
    }
  }
}

export default async function HomePage() {
  const landingStats = await getLandingStats()

  return (
    <div className="bg-hero text-Heres-white">
      <section className="relative overflow-hidden px-4 pt-32 pb-24 sm:px-6 lg:px-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(34,211,238,0.22),transparent_32%),radial-gradient(circle_at_18%_78%,rgba(34,211,238,0.18),transparent_22%),radial-gradient(circle_at_86%_24%,rgba(34,211,238,0.12),transparent_24%)]" />
        <div className="pointer-events-none absolute left-1/2 top-16 h-[520px] w-[520px] -translate-x-1/2 rounded-full border border-Heres-accent/20 bg-[radial-gradient(circle_at_50%_45%,rgba(34,211,238,0.28),rgba(9,17,34,0.08)_48%,transparent_70%)] blur-[2px]" />
        <div className="pointer-events-none absolute left-1/2 top-8 h-[620px] w-[620px] -translate-x-1/2 rounded-full border border-Heres-accent/10" />

        <div className="relative mx-auto max-w-6xl text-center">
          <div className="inline-flex items-center gap-3 rounded-full border border-Heres-border/80 bg-black/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-Heres-accent">
            <Shield className="h-4 w-4" />
            Heres Capsule Protocol
          </div>

          <h1 className="mx-auto mt-8 max-w-4xl text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
            <span className="text-Heres-accent">Your intent.</span> Executed when you&apos;re silent
          </h1>

          <div className="mt-10">
            <Link
              href="/create"
              className="inline-flex items-center justify-center rounded-2xl bg-Heres-accent px-8 py-4 text-base font-bold uppercase tracking-[0.16em] text-slate-950 shadow-[0_0_30px_rgba(34,211,238,0.35)] transition-transform hover:-translate-y-0.5"
            >
              Create Capsules
            </Link>
          </div>

          <p className="mx-auto mt-8 max-w-3xl text-base leading-8 text-Heres-muted sm:text-lg">
            Create once, then let Heres monitor silently. When inactivity conditions are met, execution finalizes on
            Solana without manual intervention.
          </p>

          <div className="mt-12 flex flex-col items-center gap-4">
            <span className="text-sm font-semibold uppercase tracking-[0.24em] text-Heres-muted">Built With</span>
            <div className="inline-flex items-center gap-3 bg-black/40 px-5 py-3">
              <Image src="/logos/solana.svg" alt="Solana" width={28} height={28} className="h-7 w-7" unoptimized />
              <span className="text-lg font-bold uppercase tracking-[0.16em]">Solana</span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-Heres-border/60 bg-black/35">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="overflow-hidden">
            <div className="partner-marquee-track">
              <div className="partner-marquee-group">
                {partnerLogos.map((partner) => (
                  <PartnerBadge key={partner.name} {...partner} />
                ))}
              </div>
              <div className="partner-marquee-group" aria-hidden="true">
                {partnerLogos.map((partner) => (
                  <PartnerBadge key={`${partner.name}-clone`} {...partner} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-2 xl:grid-cols-3">
          {featureCards.map((card) => {
            const content = (
              <div className="rounded-[28px] border border-Heres-border/80 bg-[linear-gradient(180deg,rgba(13,20,45,0.96),rgba(8,13,30,0.92))] p-8 shadow-[0_18px_40px_rgba(0,0,0,0.22)] transition-transform hover:-translate-y-1">
                <h2 className="text-2xl font-black uppercase tracking-tight text-Heres-white">{card.title}</h2>
                <p className="mt-4 min-h-[88px] text-sm leading-7 text-Heres-muted">{card.description}</p>
                <span className="mt-8 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-Heres-accent">
                  {card.cta}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </div>
            )

            if (card.external) {
              return (
                <a key={card.title} href={card.href} target="_blank" rel="noopener noreferrer">
                  {content}
                </a>
              )
            }

            return (
              <Link key={card.title} href={card.href}>
                {content}
              </Link>
            )
          })}
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-[28px] border border-Heres-border/80 bg-[linear-gradient(180deg,rgba(13,20,45,0.97),rgba(8,13,30,0.92))] px-6 py-8 text-center shadow-[0_20px_48px_rgba(0,0,0,0.24)] sm:px-10">
          <h2 className="text-3xl font-black uppercase tracking-tight">
            Why Build With <span className="text-Heres-accent">Heres?</span>
          </h2>
          <p className="mt-3 text-sm font-semibold uppercase tracking-[0.18em] text-Heres-accent">
            Your development environment
          </p>
          <p className="mt-3 text-sm leading-7 text-Heres-muted">
            Everything you need to build privacy-preserving capsules on Solana.
          </p>

          <div className="mt-8 space-y-4 text-left">
            {whyCards.map((card) => (
              <div
                key={card.index}
                className="rounded-[24px] border border-Heres-border/70 bg-Heres-card/70 px-6 py-6 shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
              >
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-Heres-muted">{card.index}</p>
                <h3 className="mt-3 text-xl font-black uppercase tracking-tight text-Heres-accent">{card.title}</h3>
                <p className="mt-3 text-sm leading-7 text-Heres-muted">{card.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.05fr_1.2fr] lg:items-center">
          <div className="rounded-[32px] border border-Heres-border/80 bg-[radial-gradient(circle_at_28%_20%,rgba(34,211,238,0.28),transparent_40%),linear-gradient(145deg,rgba(67,91,214,0.9),rgba(34,211,238,0.82))] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.25)]">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-white/95">Heres Mobile</p>
              <span className="rounded-full border border-white/15 bg-[#11192d]/90 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/85">
                Coming Soon
              </span>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-[0.7fr_1fr] md:items-end">
              <div className="max-w-[180px] space-y-3 text-sm font-medium leading-7 text-white/90">
                <p>Secure your intent on mobile anytime, anywhere.</p>
                <p className="text-white/70">Review capsule state, monitor inactivity, and sign from your phone.</p>
              </div>

              <div className="overflow-hidden rounded-[24px] border border-white/12 bg-[#08101f]/80 px-6 pt-6">
                <Image
                  src="/solana-mobile-hero.png"
                  alt="Heres mobile preview"
                  width={900}
                  height={700}
                  className="mx-auto h-auto w-full max-w-[360px] object-contain"
                  unoptimized
                />
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-Heres-accent">Heres Mobile</p>
            <h2 className="mt-4 text-4xl font-black uppercase leading-tight tracking-tight">
              Set it once. <span className="text-Heres-accent">It runs</span>
              <br className="hidden sm:block" /> forever.
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-8 text-Heres-white/92">
              Download the APK, create a capsule in a few taps, and leave a will-like intent that lives on Solana.
              Even if you delete the app tomorrow, the capsule still executes and distributes to your beneficiaries.
            </p>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-Heres-muted">
              The future is uncertain. Set your capsule while you hold the keys, then let Heres monitor silently.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="https://seeker.solanamobile.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl border border-Heres-accent/25 bg-Heres-accent/10 px-5 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-Heres-accent"
              >
                <Smartphone className="h-4 w-4" />
                Join To Get Early Access
              </a>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-2xl border border-Heres-border/80 bg-Heres-card/70 px-5 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-Heres-white"
              >
                <Download className="h-4 w-4" />
                Download APK
              </button>
            </div>

          </div>
        </div>
      </section>

      <section className="px-4 pt-6 pb-20 text-center sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-4xl font-black uppercase tracking-tight">The possibilities are limitless</h2>
          <p className="mt-4 text-xl font-semibold uppercase tracking-[0.16em] text-Heres-accent">All On Solana</p>
        </div>
      </section>

      <section className="border-y border-Heres-border/60 bg-[linear-gradient(180deg,rgba(13,20,45,0.96),rgba(8,13,30,0.94))] px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl text-center">
          <div className="grid gap-10 border-b border-Heres-border/60 pb-12 md:grid-cols-3">
            <div className="md:border-r md:border-Heres-border/40">
              <p className="text-5xl font-black uppercase tracking-tight text-Heres-white">{formatMetricCount(landingStats.total)}</p>
              <p className="mt-3 text-sm uppercase tracking-[0.16em] text-Heres-muted">Capsules Created</p>
            </div>
            <div className="md:border-r md:border-Heres-border/40">
              <p className="text-5xl font-black uppercase tracking-tight text-Heres-white">{formatSolAmount(landingStats.totalValueSecuredLamports)} SOL</p>
              <p className="mt-3 text-sm uppercase tracking-[0.16em] text-Heres-muted">Value Secured</p>
            </div>
            <div>
              <p className="text-5xl font-black uppercase tracking-tight text-Heres-white">{formatMetricCount(landingStats.active)}</p>
              <p className="mt-3 text-sm uppercase tracking-[0.16em] text-Heres-muted">Active Capsules</p>
            </div>
          </div>

          <Link
            href="/create"
            className="mt-12 inline-flex items-center justify-center rounded-2xl bg-Heres-accent px-8 py-4 text-base font-bold uppercase tracking-[0.16em] text-slate-950 shadow-[0_0_28px_rgba(34,211,238,0.28)]"
          >
            Create Capsules
          </Link>

          <p className="mx-auto mt-8 max-w-4xl text-sm font-semibold uppercase tracking-[0.16em] text-Heres-accent">
            Currently securing {landingStats.assetSummary}
          </p>
          <p className="mx-auto mt-6 max-w-4xl text-lg font-medium uppercase tracking-[0.12em] text-Heres-muted">
            Your comprehensive digital inheritance vault built on <span className="text-Heres-accent">Solana.</span>
          </p>
        </div>
      </section>

      <section className="px-4 pt-16 pb-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-Heres-accent">Feedback</p>
          <h2 className="mt-4 text-3xl font-black uppercase tracking-tight text-Heres-white">Help Shape Heres</h2>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-Heres-muted">
            Tell us what feels unclear, what should be faster, or what you want to trust before moving real assets.
          </p>

          <div className="mt-8 rounded-[24px] border border-Heres-border/80 bg-Heres-card/70 p-5 text-left shadow-[0_20px_50px_rgba(0,0,0,0.2)]">
            <form className="space-y-3">
              <input
                type="text"
                placeholder="Your Name"
                className="w-full rounded-xl border border-Heres-border/80 bg-black/25 px-4 py-3 text-sm text-Heres-white placeholder:text-Heres-muted focus:border-Heres-accent/40 focus:outline-none"
              />
              <input
                type="email"
                placeholder="Your Email"
                className="w-full rounded-xl border border-Heres-border/80 bg-black/25 px-4 py-3 text-sm text-Heres-white placeholder:text-Heres-muted focus:border-Heres-accent/40 focus:outline-none"
              />
              <textarea
                placeholder="Your Message"
                rows={4}
                className="w-full rounded-xl border border-Heres-border/80 bg-black/25 px-4 py-3 text-sm text-Heres-white placeholder:text-Heres-muted focus:border-Heres-accent/40 focus:outline-none"
              />
              <button
                type="button"
                className="inline-flex w-full items-center justify-center rounded-xl bg-Heres-accent px-4 py-3 text-sm font-bold uppercase tracking-[0.16em] text-slate-950"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      </section>

    </div>
  )
}

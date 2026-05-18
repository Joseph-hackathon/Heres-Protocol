import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Shield, Smartphone, Sparkles } from 'lucide-react'
import { getDashboardSnapshot } from '@/lib/dashboard'

const partnerLogos = [
  { name: 'Colosseum', src: '/logos/colosseum-logo-white.svg', logoWidth: 122, wordmarkOnly: true },
  { name: 'MagicBlock', src: '/logos/magicblock.svg' },
  { name: 'Solana', src: '/logos/solana.svg' },
  { name: 'Helius', src: '/logos/helius.svg' },
  { name: 'Alchemy', src: '/logos/alchemy-logo.svg', logoWidth: 112, wordmarkOnly: true },
]

const capabilityCards = [
  {
    title: 'Private by Default',
    description:
      'Intent logic stays sealed until execution time. Beneficiaries and trigger rules do not leak into public coordination flows.',
    accent: 'Privacy',
  },
  {
    title: 'Automated Execution',
    description:
      'When inactivity conditions are met, Heres finalizes execution on Solana without requiring a final manual action from the owner.',
    accent: 'Execution',
  },
  {
    title: 'Built for Real Assets',
    description:
      'Support SOL and selected assets while keeping the setup lightweight enough for a consumer-facing inheritance or recovery product.',
    accent: 'Assets',
  },
]

const productFlow = [
  {
    id: '01',
    title: 'Define the capsule',
    body: 'Choose the asset, configure beneficiaries, and write the intent once in a single creation flow.',
  },
  {
    id: '02',
    title: 'Monitor silently',
    body: 'Heres watches inactivity and execution prerequisites through the private monitoring stack built around MagicBlock PER.',
  },
  {
    id: '03',
    title: 'Settle on Solana',
    body: 'When the conditions are satisfied, the capsule executes and distributes according to the owner’s original instructions.',
  },
]

const useCases = [
  {
    eyebrow: 'Inheritance',
    title: 'Long-term asset handoff',
    description: 'A capsule can hold clear beneficiary rules for SOL and selected assets without depending on a manual executor later.',
  },
  {
    eyebrow: 'Recovery',
    title: 'Silent fallback plan',
    description: 'Set an inactivity window and keep a recovery path in place if a wallet owner disappears or loses access.',
  },
  {
    eyebrow: 'Mobile',
    title: 'Consumer-ready onboarding',
    description: 'Pair the protocol with a mobile-first flow so setup can feel closer to a modern finance app than a governance dashboard.',
  },
]

function PartnerBadge({
  name,
  src,
  logoWidth,
  wordmarkOnly,
}: {
  name: string
  src: string
  logoWidth?: number
  wordmarkOnly?: boolean
}) {
  return (
    <div
      aria-label={name}
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
    </div>
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
    <div className="landing-aurora bg-Heres-navyDeep text-Heres-white">
      <section className="relative overflow-hidden px-4 pt-32 pb-24 sm:px-6 lg:px-8">
        <div className="landing-grid pointer-events-none absolute inset-0 opacity-70" />
        <div className="landing-noise pointer-events-none absolute inset-0 opacity-20" />
        <div className="landing-spotlight pointer-events-none absolute inset-0" />
        <div className="landing-beam pointer-events-none absolute -left-[10%] top-20 h-[420px] w-[420px] rounded-full" />
        <div className="landing-beam landing-beam-delay pointer-events-none absolute right-[-12%] top-10 h-[520px] w-[520px] rounded-full" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(47,120,255,0.18),transparent_28%),radial-gradient(circle_at_65%_12%,rgba(34,211,238,0.14),transparent_24%),radial-gradient(circle_at_60%_78%,rgba(67,91,214,0.18),transparent_34%)]" />
        <div className="pointer-events-none absolute right-[-10%] top-20 h-[480px] w-[480px] rounded-full border border-Heres-accent/10 bg-[radial-gradient(circle_at_50%_50%,rgba(34,211,238,0.22),rgba(9,17,34,0.04)_55%,transparent_74%)] blur-xl" />
        <div className="landing-scanline pointer-events-none absolute inset-x-0 top-24 h-px" />

        <div className="relative mx-auto grid max-w-7xl gap-16 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-Heres-border/70 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.26em] text-Heres-accent shadow-[0_0_24px_rgba(34,211,238,0.08)]">
              <Shield className="h-4 w-4" />
              Privacy-preserving execution on Solana
            </div>

            <h1 className="mt-8 max-w-5xl text-5xl font-black uppercase leading-[0.92] tracking-[-0.04em] text-white sm:text-7xl lg:text-[96px] [text-wrap:balance]">
              <span className="text-Heres-accent">Death Insurance</span>
              <br />
              Protocol
            </h1>

            <p className="mt-8 max-w-3xl text-base leading-8 text-Heres-muted sm:text-lg">
              Heres is a private capsule layer for long-horizon asset instructions. Set beneficiaries, inactivity
              rules, and execution intent once, then let Solana settle the outcome when the conditions are met.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                href="/create"
                className="inline-flex items-center gap-2 rounded-2xl bg-Heres-accent px-6 py-4 text-sm font-bold uppercase tracking-[0.18em] text-slate-950 shadow-[0_0_32px_rgba(34,211,238,0.24)] transition-transform hover:-translate-y-0.5"
              >
                Create Capsule
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-2xl border border-Heres-border/70 bg-white/[0.03] px-6 py-4 text-sm font-semibold uppercase tracking-[0.16em] text-Heres-white transition-colors hover:border-Heres-accent/30 hover:bg-Heres-card/70"
              >
                Open Dashboard
              </Link>
            </div>
          </div>

          <div className="landing-float-card landing-interactive-card rounded-[32px] border border-Heres-border/80 bg-[linear-gradient(180deg,rgba(13,20,45,0.96),rgba(8,13,30,0.92))] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.32)]">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="landing-stat-card rounded-[22px] border border-Heres-border/70 bg-black/25 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-Heres-muted">Capsules Created</p>
                <p className="mt-4 text-4xl font-black tracking-tight text-white">{formatMetricCount(landingStats.total)}</p>
              </div>
              <div className="landing-stat-card rounded-[22px] border border-Heres-border/70 bg-black/25 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-Heres-muted">Value Secured</p>
                <p className="mt-4 text-4xl font-black tracking-tight text-Heres-accent">{formatSolAmount(landingStats.totalValueSecuredLamports)} SOL</p>
              </div>
              <div className="landing-stat-card rounded-[22px] border border-Heres-border/70 bg-black/25 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-Heres-muted">Active Capsules</p>
                <p className="mt-4 text-4xl font-black tracking-tight text-white">{formatMetricCount(landingStats.active)}</p>
              </div>
              <div className="landing-stat-card rounded-[22px] border border-Heres-border/70 bg-black/25 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-Heres-muted">Asset Mix</p>
                <p className="mt-4 text-lg font-semibold leading-7 text-white">{landingStats.assetSummary}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section-beam border-y border-Heres-border/60 bg-black/35">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="mb-4 flex items-center justify-center">
            <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-Heres-muted">Built with</span>
          </div>
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

      <section className="landing-section-beam px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-Heres-accent">Why Heres</p>
            <h2 className="mt-4 text-4xl font-black uppercase leading-tight tracking-[-0.03em] text-white sm:text-5xl">
              A protocol surface for assets that should not depend on a final click.
            </h2>
          </div>

          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {capabilityCards.map((card) => (
              <div
                key={card.title}
                className="landing-float-card landing-interactive-card rounded-[30px] border border-Heres-border/70 bg-[linear-gradient(180deg,rgba(10,14,30,0.98),rgba(8,13,30,0.92))] p-8 shadow-[0_18px_42px_rgba(0,0,0,0.22)]"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-Heres-accent">{card.accent}</p>
                <h3 className="mt-6 text-3xl font-black uppercase leading-tight tracking-[-0.03em] text-white">{card.title}</h3>
                <p className="mt-6 text-sm leading-8 text-Heres-muted">{card.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section-beam px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-Heres-accent">Product Flow</p>
            <h2 className="mt-4 text-4xl font-black uppercase leading-tight tracking-[-0.03em] text-white sm:text-5xl">
              One setup path.
              <br />
              Three durable outcomes.
            </h2>
            <p className="mt-6 max-w-xl text-base leading-8 text-Heres-muted">
              The experience should feel closer to a modern product flow than a raw protocol console. Create the
              capsule, leave it alone, and let the chain do the eventual settlement work.
            </p>
          </div>

          <div className="space-y-6">
            {productFlow.map((item) => (
              <div
                key={item.id}
                className="landing-float-card landing-interactive-card rounded-[30px] border border-Heres-border/70 bg-[linear-gradient(180deg,rgba(10,14,30,0.98),rgba(8,13,30,0.92))] p-8 shadow-[0_18px_42px_rgba(0,0,0,0.18)]"
              >
                <div className="flex items-start justify-between gap-6">
                  <span className="text-5xl font-black tracking-[-0.05em] text-Heres-accent/90">{item.id}</span>
                  <Sparkles className="mt-1 h-5 w-5 shrink-0 text-Heres-accent/70" />
                </div>
                <h3 className="mt-8 text-3xl font-black uppercase leading-tight tracking-[-0.03em] text-white">{item.title}</h3>
                <p className="mt-5 max-w-2xl text-sm leading-8 text-Heres-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section-beam px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="landing-float-card landing-interactive-card rounded-[34px] border border-Heres-border/80 bg-[radial-gradient(circle_at_24%_18%,rgba(34,211,238,0.26),transparent_34%),linear-gradient(145deg,rgba(23,35,76,0.98),rgba(8,13,30,0.92))] p-7 shadow-[0_24px_60px_rgba(0,0,0,0.3)]">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-white/90">Heres Mobile</p>
              <span className="rounded-full border border-white/15 bg-black/20 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
                Consumer-ready
              </span>
            </div>

            <div className="mt-8 overflow-hidden rounded-[28px] border border-white/10 bg-[#09101f] px-6 pt-6">
              <Image
                src="/solana-mobile-hero.png"
                alt="Heres mobile preview"
                width={900}
                height={700}
                className="mx-auto h-auto w-full max-w-[420px] object-contain"
                unoptimized
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-Heres-accent">Mobile Layer</p>
            <h2 className="mt-4 text-4xl font-black uppercase leading-tight tracking-[-0.03em] text-white sm:text-5xl">
              Consumer-facing setup
              <br />
              for a protocol-native vault.
            </h2>
            <p className="mt-6 max-w-xl text-base leading-8 text-Heres-muted">
              Mobile onboarding matters because an inheritance or recovery product should not feel like developer
              infrastructure. Heres turns the creation flow into something lightweight enough to start from a phone.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="https://seeker.solanamobile.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl bg-Heres-accent px-6 py-4 text-sm font-bold uppercase tracking-[0.18em] text-slate-950 shadow-[0_0_28px_rgba(34,211,238,0.22)]"
              >
                <Smartphone className="h-4 w-4" />
                Explore Mobile
              </a>
              <Link
                href="/create"
                className="inline-flex items-center gap-2 rounded-2xl border border-Heres-border/70 bg-white/[0.03] px-6 py-4 text-sm font-semibold uppercase tracking-[0.16em] text-Heres-white transition-colors hover:border-Heres-accent/30 hover:bg-Heres-card/70"
              >
                Start on Web
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section-beam px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-6 border-b border-Heres-border/60 pb-10 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-Heres-accent">Use Cases</p>
              <h2 className="mt-4 text-4xl font-black uppercase leading-tight tracking-[-0.03em] text-white sm:text-5xl">
                The possibilities are durable,
                <br />
                all on Solana.
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-8 text-Heres-muted">
              From inheritance planning to silent recovery paths, the product surface stays simple while the execution
              layer remains verifiable and protocol-native.
            </p>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {useCases.map((item) => (
              <div
                key={item.title}
                className="landing-float-card landing-interactive-card rounded-[30px] border border-Heres-border/70 bg-[linear-gradient(180deg,rgba(10,14,30,0.98),rgba(8,13,30,0.92))] p-8"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-Heres-accent">{item.eyebrow}</p>
                <h3 className="mt-6 text-3xl font-black uppercase leading-tight tracking-[-0.03em] text-white">{item.title}</h3>
                <p className="mt-6 text-sm leading-8 text-Heres-muted">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section-beam border-y border-Heres-border/60 bg-[linear-gradient(180deg,rgba(13,20,45,0.96),rgba(8,13,30,0.94))] px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl text-center">
          <div className="grid gap-10 border-b border-Heres-border/60 pb-12 md:grid-cols-3">
            <div className="md:border-r md:border-Heres-border/40">
              <p className="text-5xl font-black uppercase tracking-tight text-white">{formatMetricCount(landingStats.total)}</p>
              <p className="mt-3 text-sm uppercase tracking-[0.16em] text-Heres-muted">Capsules Created</p>
            </div>
            <div className="md:border-r md:border-Heres-border/40">
              <p className="text-5xl font-black uppercase tracking-tight text-Heres-accent">{formatSolAmount(landingStats.totalValueSecuredLamports)} SOL</p>
              <p className="mt-3 text-sm uppercase tracking-[0.16em] text-Heres-muted">Value Secured</p>
            </div>
            <div>
              <p className="text-5xl font-black uppercase tracking-tight text-white">{formatMetricCount(landingStats.executed)}</p>
              <p className="mt-3 text-sm uppercase tracking-[0.16em] text-Heres-muted">Executed Capsules</p>
            </div>
          </div>

          <p className="mx-auto mt-8 max-w-4xl text-sm font-semibold uppercase tracking-[0.16em] text-Heres-accent">
            Currently securing {landingStats.assetSummary}
          </p>
          <h2 className="mx-auto mt-6 max-w-5xl text-3xl font-black uppercase leading-tight tracking-[-0.03em] text-white sm:text-5xl">
            Build a recovery layer that can outlast the last login.
          </h2>

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/create"
              className="inline-flex items-center gap-2 rounded-2xl bg-Heres-accent px-6 py-4 text-sm font-bold uppercase tracking-[0.18em] text-slate-950 shadow-[0_0_28px_rgba(34,211,238,0.24)]"
            >
              Create Capsule
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-2xl border border-Heres-border/70 bg-white/[0.03] px-6 py-4 text-sm font-semibold uppercase tracking-[0.16em] text-Heres-white transition-colors hover:border-Heres-accent/30 hover:bg-Heres-card/70"
            >
              View Network Activity
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

'use client'

import Link from 'next/link'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { useRef, useEffect, useState } from 'react'
import { getNetworkDisplayLabel } from '@/constants'

const AsciiCapsule = dynamic(() => import('@/components/AsciiCapsule').then((m) => ({ default: m.AsciiCapsule })), {
  ssr: false,
  loading: () => <div className="min-h-[120px]" aria-hidden />,
})

const HeroCapsuleVideo = dynamic(() => import('@/components/HeroCapsuleVideo').then((m) => ({ default: m.HeroCapsuleVideo })), {
  ssr: false,
  loading: () => <div className="aspect-video w-full animate-pulse rounded-2xl bg-Heres-surface/50" aria-hidden />,
})


function DashedLine({
  height = 50,
  segmentIndex,
  activeWhyIndex,
}: {
  height?: number
  segmentIndex: number
  activeWhyIndex: number
}) {
  const active = activeWhyIndex >= segmentIndex
  const filled = activeWhyIndex > segmentIndex
  return (
    <div className="relative flex justify-center" style={{ height }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox={`0 0 2 ${height}`}
        width={2}
        height={height}
        className="shrink-0 text-white why-flow-dashed-line"
      >
        <path
          stroke="currentColor"
          strokeDasharray="5 5"
          strokeLinecap="square"
          strokeOpacity={0.5}
          strokeWidth={1.5}
          d={`M1 1v${height - 2}`}
        />
      </svg>
      {filled && (
        <div
          className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-Heres-accent rounded-full"
          aria-hidden
          style={{ height }}
        />
      )}
      {active && !filled && (
        <div
          className="why-flow-segment absolute left-1/2 top-0 h-3 w-0.5 -translate-x-1/2 bg-Heres-accent rounded-full"
          aria-hidden
        />
      )}
    </div>
  )
}

const features: any[] = []

/* Why Heres benefit-focused cards */
const whyHeresCards = [
  {
    title: 'Your intent, executed when it matters',
    description: 'Leave instructions that run only when the time is right. No one can execute early. Your conditions stay yours until the moment you chose.',
    image: '/why-Heres-1.png',
    href: '/create',
  },
  {
    title: 'Privacy by design',
    description: 'Your conditions stay private. Only the outcome is visible on-chain. No third party sees your rules. Just the result when silence becomes truth.',
    image: '/why-Heres-2.png',
    href: '/dashboard',
  },
  {
    title: "Set it once. It runs when you're silent.",
    description: 'Define your intent once. No bridges, no middlemen. When your conditions are met, execution happens automatically, the way you wanted.',
    image: '/why-Heres-3.png',
    href: '/create',
  },
]

export default function HomePage() {
  const heroRef = useRef<HTMLDivElement>(null)
  const whySectionRef = useRef<HTMLElement>(null)
  const whyTitleRef = useRef<HTMLHeadingElement>(null)
  const whyLeftRef = useRef<HTMLDivElement>(null)
  const whyVisualMainRef = useRef<HTMLDivElement>(null)
  const howTitleRef = useRef<HTMLHeadingElement>(null)
  const stepsRef = useRef<HTMLDivElement>(null)
  const partnersSectionRef = useRef<HTMLElement>(null)
  const unleashRef = useRef<HTMLElement>(null)
  const [activeWhyIndex, setActiveWhyIndex] = useState(0)
  const gsapCtxRef = useRef<{ revert?: () => void } | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const gsap = (await import('gsap')).default
      const ScrollTrigger = (await import('gsap/ScrollTrigger')).default
      gsap.registerPlugin(ScrollTrigger)
      if (cancelled) return
      gsapCtxRef.current = gsap.context(() => {
        gsap.from(heroRef.current?.querySelector('[data-hero-tag]') ?? {}, {
          opacity: 0,
          y: 20,
          duration: 0.6,
          ease: 'power3.out',
        })
        gsap.from(heroRef.current?.querySelector('h1') ?? {}, {
          opacity: 0,
          y: 40,
          duration: 0.8,
          delay: 0.15,
          ease: 'power3.out',
        })
        gsap.from(heroRef.current?.querySelector('[data-hero-ascii]') ?? {}, {
          opacity: 0,
          y: 24,
          duration: 0.9,
          delay: 0.3,
          ease: 'power3.out',
        })
        gsap.from(heroRef.current?.querySelector('[data-hero-below-capsule]') ?? {}, {
          opacity: 0,
          y: 20,
          duration: 0.8,
          delay: 0.6,
          ease: 'power3.out',
        })
        if (whySectionRef.current) {
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: whySectionRef.current,
              start: 'top 82%',
              end: 'top 20%',
              once: true,
            },
          })
          if (whyTitleRef.current) {
            tl.from(whyTitleRef.current, { opacity: 0, y: 28, duration: 0.65, ease: 'power3.out' })
          }
          const whyHeading = whySectionRef.current.querySelector('[data-why-heading]')
          if (whyHeading) {
            tl.from(whyHeading, { opacity: 0, y: 20, duration: 0.5, ease: 'power3.out' }, '-=0.4')
          }
          if (whyLeftRef.current) {
            const cards = whyLeftRef.current.querySelectorAll('[data-gsap-why-card]')
            tl.fromTo(cards, { y: 32, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.12, ease: 'power3.out' }, '-=0.35')
          }
          if (whyVisualMainRef.current) {
            tl.from(whyVisualMainRef.current, { x: 48, opacity: 0, duration: 0.7, ease: 'power3.out' }, '-=0.45')
          }
        }
        if (howTitleRef.current) {
          ScrollTrigger.create({
            trigger: howTitleRef.current,
            start: 'top 85%',
            onEnter: () => {
              gsap.from(howTitleRef.current, { opacity: 0, y: 30, duration: 0.7, ease: 'power3.out' })
            },
            once: true,
          })
        }
        if (stepsRef.current) {
          const stepEls = stepsRef.current.querySelectorAll('[data-gsap-step]')
          gsap.fromTo(
            stepEls,
            { y: 32 },
            {
              y: 0,
              scrollTrigger: { trigger: stepsRef.current, start: 'top 88%', once: true },
              stagger: 0.12,
              duration: 0.5,
              ease: 'power3.out',
            }
          )
        }
        if (partnersSectionRef.current) {
          gsap.from(partnersSectionRef.current.querySelector('h2'), {
            scrollTrigger: { trigger: partnersSectionRef.current, start: 'top 85%', once: true },
            opacity: 0,
            y: 30,
            duration: 0.7,
            ease: 'power3.out',
          })
        }
        if (unleashRef.current) {
          const left = unleashRef.current.querySelector('[data-gsap-unleash-text]')
          const right = unleashRef.current.querySelector('[data-gsap-unleash-3d]')
          gsap.from(left, {
            scrollTrigger: { trigger: unleashRef.current, start: 'top 80%', once: true },
            opacity: 0,
            x: -50,
            duration: 0.9,
            ease: 'power3.out',
          })
          gsap.from(right, {
            scrollTrigger: { trigger: unleashRef.current, start: 'top 80%', once: true },
            opacity: 0,
            x: 50,
            duration: 0.9,
            delay: 0.2,
            ease: 'power3.out',
          })
        }
      })
    })()
    return () => {
      cancelled = true
      if (gsapCtxRef.current?.revert) gsapCtxRef.current.revert()
      gsapCtxRef.current = null
    }
  }, [])

  return (
    <div className="bg-hero grain-overlay">
      {/* Hero */}
      <section
        ref={heroRef}
        className="relative overflow-hidden px-4 pt-36 pb-32 sm:px-6 sm:pt-44 sm:pb-40 lg:px-8"
      >
        {/* Decorative hero glow orbs */}
        <div className="pointer-events-none absolute top-0 left-1/4 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-Heres-cyan/[0.04] blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute top-20 right-1/4 translate-x-1/2 w-[500px] h-[500px] rounded-full bg-Heres-purple/[0.04] blur-[100px]" aria-hidden />

        <div className="mx-auto max-w-5xl text-center">
          <div data-hero-tag className="mb-6 inline-flex items-center gap-2">
            <span className="tag-pill">
              <span className="accent-dot" />
              Privacy-Preserving Capsule Protocol
            </span>
          </div>
          <h1 className="font-display text-5xl font-bold uppercase tracking-tight text-Heres-white sm:text-6xl lg:text-7xl xl:text-8xl leading-[0.95]">
            Your intent. Your rules.{' '}
            <span className="text-shimmer">
              Executed when you&apos;re silent.
            </span>
          </h1>
          {/* ASCII capsule animation */}
          <div className="mt-12 sm:mt-14" data-hero-ascii>
            <AsciiCapsule />
          </div>
          {/* Description + CTAs */}
          <div className="mt-12 sm:mt-14 text-center" data-hero-below-capsule>
            <p className="mx-auto max-w-2xl text-base sm:text-lg text-Heres-muted leading-relaxed">
              Define once. Delegate to Magicblock PER (TEE). Execution runs on Solana when conditions are met. No bridges, no third party.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                href="/create"
                className="btn-primary min-w-[180px] shrink-0 rounded-full py-4 text-center text-sm"
              >
                Get Started
              </Link>
              <button
                type="button"
                className="btn-secondary min-w-[180px] shrink-0 rounded-full py-4 text-center text-sm"
                aria-label="Download APK (coming soon)"
              >
                Download APK
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="glow-line" />

      {/* Why Build With Heres */}
      <section ref={whySectionRef} className="why-build-section py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 ref={whyTitleRef} className="font-display text-3xl font-bold uppercase tracking-tight text-white sm:text-4xl lg:text-5xl">
              Why Build With Heres?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-Heres-muted hidden">
              Capsules on Solana, private logic in Magicblock PER (TEE), execution when you&apos;re silent.
            </p>
          </div>

          <div data-why-heading className="mx-auto mt-4 max-w-2xl text-center">
            <p className="why-build-subtitle text-lg font-medium font-display uppercase tracking-wide">Your development environment</p>
            <p className="why-build-desc mt-2">Everything you need to build privacy-preserving capsules on Solana.</p>
          </div>

          <div className="mt-20 grid gap-12 lg:grid-cols-2 lg:gap-20 lg:items-center">
            {/* Left: Why Heres steps */}
            <div ref={whyLeftRef} className="why-left-cards flex flex-col">
              {whyHeresCards.map((card, i) => {
                const isActive = activeWhyIndex === i
                return (
                  <div
                    key={card.title}
                    role="button"
                    tabIndex={0}
                    data-gsap-why-card
                    data-active={isActive}
                    onClick={() => setActiveWhyIndex(i)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveWhyIndex(i) } }}
                    className={`flex cursor-pointer flex-col py-6 transition-all duration-500 ${isActive ? 'opacity-100' : 'opacity-40 hover:opacity-70'}`}
                  >
                    <div
                      className={`relative flex items-start transition-all duration-500 ${isActive ? 'pl-5' : 'pl-0'}`}
                      style={{
                        borderLeft: isActive ? '2px solid rgba(34, 211, 238, 0.4)' : '2px solid transparent',
                      }}
                    >
                      {isActive && (
                        <div
                          key={`step-bar-${i}`}
                          className="why-build-step-bar absolute left-0 top-0 w-0.5 bg-Heres-accent"
                          aria-hidden
                          onAnimationEnd={() => setActiveWhyIndex((prev) => (prev + 1) % whyHeresCards.length)}
                        />
                      )}
                      <div>
                        <div className="mb-2 font-display text-xs font-medium uppercase tracking-widest text-Heres-accent/60">
                          Step {i + 1}
                        </div>
                        <h3 className="mb-3 font-display text-xl font-bold uppercase tracking-tight text-white">
                          {card.title}
                        </h3>
                        <p className="text-sm leading-relaxed text-white/50">
                          {card.description}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Right: Heres flow diagram */}
            <div ref={whyVisualMainRef} className="relative w-full md:min-w-0 md:flex-1 lg:max-w-[900px]">
              <div className="why-build-flow-wrap relative flex flex-col md:flex-row md:items-stretch md:gap-0 md:pl-2 md:pr-4">
                <div className="relative mt-4 flex w-full flex-col items-center text-white md:mt-0 md:w-full md:scale-100">
                  {/* 1. Solana settlement */}
                  <div
                    className="z-10 flex w-full justify-center"
                    style={{ opacity: activeWhyIndex >= 0 ? 1 : 0.4, transform: activeWhyIndex >= 0 ? 'scale(1)' : 'scale(0.98)', transition: 'opacity 0.3s, transform 0.3s' }}
                  >
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-3 text-center md:p-4 w-[164px]">
                      <div className="flex items-center justify-center gap-2 font-display text-sm md:text-base text-white whitespace-nowrap uppercase tracking-wide">
                        <Image src="/logos/solana.svg" alt="Solana" width={24} height={24} className="shrink-0" unoptimized />
                        <span>{getNetworkDisplayLabel()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="relative flex justify-center" style={{ opacity: 1 }}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 2 50" width={2} height={50} className="shrink-0 text-white">
                      <path stroke="currentColor" strokeDasharray="5 5" strokeLinecap="square" strokeOpacity={0.5} strokeWidth={1.5} d="M1 1v48" />
                    </svg>
                    {activeWhyIndex > 0 && (
                      <div className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-Heres-accent rounded-full" aria-hidden style={{ height: 50 }} />
                    )}
                    {activeWhyIndex === 0 && (
                      <div className="why-flow-segment absolute left-1/2 h-6 w-[1.5px] -translate-x-1/2 rounded-full bg-Heres-accent" aria-hidden style={{ top: 0 }} />
                    )}
                  </div>
                  {/* 2. Heres Capsules */}
                  <div
                    className="z-10 flex w-full justify-center"
                    style={{ opacity: activeWhyIndex >= 0 ? 1 : 0.4, transform: activeWhyIndex >= 0 ? 'scale(1)' : 'scale(0.98)', transition: 'opacity 0.3s, transform 0.3s' }}
                  >
                    <div className="rounded-xl w-[164px] border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-3 text-center md:p-4">
                      <div className="font-display text-sm md:text-base text-white uppercase tracking-wide">Heres Capsules</div>
                    </div>
                  </div>
                  {/* Parallel dashed lines */}
                  <div className="relative -z-10 flex w-full justify-center gap-2 md:gap-6" style={{ opacity: activeWhyIndex >= 0 ? 1 : 0.4, transition: 'opacity 0.3s' }}>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="relative flex justify-center" style={{ opacity: 1 }}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 2 30" width={2} height={30} className="shrink-0 text-white">
                          <path stroke="currentColor" strokeDasharray="5 5" strokeLinecap="square" strokeOpacity={0.5} strokeWidth={1.5} d="M1 1v28" />
                        </svg>
                        {activeWhyIndex > 1 && <div className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-Heres-accent rounded-full" style={{ height: 30 }} aria-hidden />}
                      </div>
                    ))}
                  </div>
                  {/* Tokens or NFTs */}
                  <div
                    className="z-20 flex w-full justify-center"
                    style={{ opacity: activeWhyIndex >= 0 ? 1 : 0.4, transform: activeWhyIndex >= 0 ? 'scale(1)' : 'scale(0.95)', transition: 'opacity 0.3s, transform 0.3s' }}
                  >
                    <div className="rounded-lg w-[140px] whitespace-nowrap border border-white/[0.08] bg-white/[0.03] px-1.5 py-1 text-center font-display text-[11px] uppercase leading-none tracking-wider text-white/50">
                      Tokens or NFTs
                    </div>
                  </div>
                  {/* Parallel dashed lines again */}
                  <div className="relative -z-10 flex w-full justify-center gap-2 md:gap-6" style={{ opacity: activeWhyIndex >= 0 ? 1 : 0.4, transition: 'opacity 0.3s' }}>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="relative flex justify-center" style={{ opacity: 1 }}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 2 30" width={2} height={30} className="shrink-0 text-white">
                          <path stroke="currentColor" strokeDasharray="5 5" strokeLinecap="square" strokeOpacity={0.5} strokeWidth={1.5} d="M1 1v28" />
                        </svg>
                        {activeWhyIndex > 1 && <div className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-Heres-accent rounded-full" style={{ height: 30 }} aria-hidden />}
                      </div>
                    ))}
                  </div>
                  {/* 3. Magicblock PER (TEE) */}
                  <div
                    className="relative z-20 flex w-full justify-center"
                    style={{ opacity: activeWhyIndex >= 1 ? 1 : 0.4, transform: activeWhyIndex >= 1 ? 'scale(1)' : 'scale(0.95)', transition: 'opacity 0.3s, transform 0.3s' }}
                  >
                    <div className="flex flex-col items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm px-3 py-2 leading-none md:px-4 md:py-2.5 min-w-[220px] w-[220px]">
                      <div className="flex items-center gap-2 justify-center whitespace-nowrap">
                        <Image src="/logos/magicblock.svg" alt="Magicblock" width={20} height={20} className="shrink-0" unoptimized />
                        <span className="font-display text-[11px] uppercase tracking-wider text-white/60">Magicblock PER (TEE)</span>
                      </div>
                      <span className="font-display text-[9px] uppercase tracking-widest text-white/30">Privacy</span>
                    </div>
                  </div>
                  <div className="relative flex justify-center">
                    <DashedLine height={30} segmentIndex={2} activeWhyIndex={activeWhyIndex} />
                  </div>
                  {/* 4. Monitoring */}
                  <div
                    className="z-10 flex w-full justify-center"
                    style={{ opacity: activeWhyIndex >= 1 ? 1 : 0.4, transform: activeWhyIndex >= 1 ? 'scale(1)' : 'scale(0.98)', transition: 'opacity 0.3s, transform 0.3s' }}
                  >
                    <div className="flex flex-col items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm px-3 py-2 leading-none md:px-4 md:py-2.5 w-[164px]">
                      <div className="flex items-center gap-2 justify-center leading-none">
                        <Image src="/logos/helius.svg" alt="Helius" width={18} height={18} className="shrink-0" unoptimized />
                        <span className="font-display text-[11px] uppercase tracking-wider text-white/60">Monitoring</span>
                      </div>
                      <span className="font-display text-[10px] uppercase tracking-wider text-white/40 leading-none">Helius RPC</span>
                    </div>
                  </div>
                  <div className="relative flex justify-center">
                    <DashedLine height={28} segmentIndex={2} activeWhyIndex={activeWhyIndex} />
                  </div>
                  {/* 5. Execution */}
                  <div
                    className="z-10 flex w-full justify-center"
                    style={{ opacity: activeWhyIndex >= 0 ? 1 : 0.4, transform: activeWhyIndex >= 0 ? 'scale(1)' : 'scale(0.98)', transition: 'opacity 0.3s, transform 0.3s' }}
                  >
                    <div className="relative overflow-hidden rounded-xl border border-Heres-accent/20 bg-white/[0.03] backdrop-blur-sm p-3.5 text-center w-[220px] min-w-[220px]">
                      <div
                        className="absolute inset-0 rounded-xl bg-Heres-accent/20 transition-all duration-700 ease-out"
                        style={{ width: `${((activeWhyIndex + 1) / 3) * 100}%` }}
                        aria-hidden
                      />
                      <div className="relative z-10">
                        <div className="font-display text-sm font-bold uppercase tracking-wide text-white">Execution</div>
                        <div className="mt-1.5 whitespace-nowrap font-display text-[10px] uppercase tracking-widest text-white/50">Auto execute to Devnet</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="glow-line" />

      {/* How it works - Bento Grid */}
      <section className="relative py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 ref={howTitleRef} className="font-display text-3xl font-bold uppercase tracking-tight text-Heres-white sm:text-4xl lg:text-5xl">
              How It Works
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-Heres-muted leading-relaxed">
              With Heres, define your intent once on Solana. Magicblock PER (TEE) monitors privately; execution runs on Devnet when conditions are met.
            </p>
          </div>

          {/* Bento grid layout */}
          <div ref={stepsRef} className="mt-16 grid gap-4 lg:grid-cols-3 lg:grid-rows-[auto] lg:items-stretch">
            {/* STEP 1 Create - tall card */}
            <div data-gsap-step className="card-bento group flex flex-col p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-Heres-accent/10 font-display text-sm font-bold text-Heres-accent">01</span>
                <h3 className="font-display text-xl font-bold uppercase tracking-tight text-Heres-white">Create</h3>
              </div>
              <p className="text-sm text-Heres-muted leading-relaxed">
                Create a capsule to define beneficiaries, amounts, and inactivity period on the active Solana network.
              </p>
              <div className="mt-6 flex-1 overflow-hidden rounded-xl border border-white/[0.06] bg-black/20">
                <div className="relative h-full min-h-[200px] w-full">
                  <Image
                    src="/how-it-works-step1.png"
                    alt="Create Capsule - intent, beneficiaries, asset type"
                    fill
                    className="object-cover object-top transition-transform duration-700 group-hover:scale-[1.02]"
                    sizes="(max-width: 768px) 100vw, 33vw"
                    unoptimized
                  />
                </div>
              </div>
              <Link href="/create" className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-Heres-accent/80 transition-colors hover:text-Heres-accent">
                View the create page
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>

            {/* STEP 2 Delegate - code card */}
            <div data-gsap-step className="card-bento group flex flex-col p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-Heres-purple/10 font-display text-sm font-bold text-Heres-purple">02</span>
                <h3 className="font-display text-xl font-bold uppercase tracking-tight text-Heres-white">Delegate</h3>
              </div>
              <p className="text-sm text-Heres-muted leading-relaxed">
                Create and delegate your capsule with Anchor. Capsule PDA is derived from owner; delegate to Magicblock PER (TEE) for private monitoring.
              </p>
              <div className="mt-6 flex-1 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0a0d14] p-4 font-mono text-xs leading-relaxed">
                <pre className="whitespace-pre-wrap break-words text-[11px] sm:text-xs">
                  <code>
                    <span className="text-Heres-muted">const tx = await program.methods</span>{'\n'}
                    <span className="text-Heres-muted">  .createCapsule(</span>{'\n'}
                    <span className="text-Heres-muted">    new BN(inactivityPeriodSeconds),</span>{'\n'}
                    <span className="text-Heres-muted">    intentDataBuffer</span>{'\n'}
                    <span className="text-Heres-muted">  )</span>{'\n'}
                    <span className="text-Heres-muted">  .accounts(</span>{'\n'}
                    <span className="text-Heres-cyan">    capsule</span>: capsulePDA,{'\n'}
                    <span className="text-Heres-cyan">    owner</span>: wallet.publicKey,{'\n'}
                    <span className="text-Heres-cyan">    systemProgram</span>: SystemProgram.programId{'\n'}
                    <span className="text-Heres-muted">  )</span>{'\n'}
                    <span className="text-Heres-muted">  .rpc()</span>
                  </code>
                </pre>
              </div>
              <Link href="/create" className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-Heres-accent/80 transition-colors hover:text-Heres-accent">
                View the code
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>

            {/* STEP 3 Serve */}
            <div data-gsap-step className="card-bento group flex flex-col p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-Heres-accent/10 font-display text-sm font-bold text-Heres-accent">03</span>
                <h3 className="font-display text-xl font-bold uppercase tracking-tight text-Heres-white">Serve</h3>
              </div>
              <p className="text-sm text-Heres-muted leading-relaxed">
                View and manage your capsules. Execution runs on Devnet when inactivity is met. No third party.
              </p>
              <div className="mt-6 flex-1 overflow-hidden rounded-xl border border-white/[0.06] bg-black/20">
                <div className="relative h-full min-h-[200px] w-full">
                  <Image
                    src="/how-it-works-step3.png"
                    alt="Heres Capsules dashboard - status, PER (TEE) execution, verification"
                    fill
                    className="object-cover object-top transition-transform duration-700 group-hover:scale-[1.02]"
                    sizes="(max-width: 768px) 100vw, 33vw"
                    unoptimized
                  />
                </div>
              </div>
              <Link href="/dashboard" className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-Heres-accent/80 transition-colors hover:text-Heres-accent">
                View the dashboard
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="glow-line" />

      {/* Heres on Solana Mobile */}
      <section className="relative py-24 sm:py-32 overflow-hidden">
        {/* Background accent */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-Heres-purple/[0.02] to-transparent" aria-hidden />
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            {/* Left: Image */}
            <div className="flex flex-col items-center justify-center order-2 lg:order-1">
              <div className="relative w-full max-w-xl lg:max-w-2xl rounded-2xl overflow-hidden border border-white/[0.06] shadow-bento">
                <Image
                  src="/solana-mobile-hero.png"
                  alt="Heres - web dashboard and mobile Create Capsule"
                  width={800}
                  height={600}
                  className="w-full h-auto"
                  sizes="(max-width: 768px) 100vw, 60vw"
                  unoptimized
                />
              </div>
            </div>
            {/* Right: Copy */}
            <div className="order-1 lg:order-2">
              <span className="tag-pill mb-6">
                <span className="accent-dot" />
                Solana Mobile Seeker
              </span>
              <h2 className="font-display text-3xl font-bold uppercase tracking-tight leading-tight text-Heres-white sm:text-4xl lg:text-5xl">
                Set it once.{' '}
                <span className="text-shimmer">It runs forever.</span>
              </h2>
              <p className="mt-6 text-lg leading-relaxed text-Heres-muted">
                Download the APK, tap a few times, and leave a will-like intent: who gets your assets and after how long of inactivity. Your capsule lives on Solana. Delete the app tomorrow. Execution still runs and distributes to your beneficiaries.
              </p>
              <p className="mt-4 text-base leading-relaxed text-white/30">
                The future is uncertain. Set your capsule while you hold the keys.
              </p>
              <Link
                href="https://seeker.solanamobile.com"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-8 inline-flex items-center gap-2 btn-secondary rounded-full py-3.5"
              >
                Download APK
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="glow-line" />

      {/* Unleash the Power of Heres */}
      <section ref={unleashRef} className="relative overflow-hidden py-28 sm:py-36">
        {/* Background orbs */}
        <div className="pointer-events-none absolute top-1/2 left-1/4 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-Heres-cyan/[0.03] blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute top-1/2 right-1/4 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-Heres-purple/[0.03] blur-[100px]" aria-hidden />

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div data-gsap-unleash-text className="max-w-xl">
              <h2 className="font-display text-4xl font-bold uppercase tracking-tight leading-[1.1] text-Heres-white sm:text-5xl lg:text-6xl">
                Unleash the Power of{' '}
                <span className="text-shimmer">Heres</span>
              </h2>
              <p className="mt-8 text-lg leading-relaxed text-Heres-muted">
                Define your intent once: beneficiaries, amounts, inactivity period. Your capsule lives on Solana; Magicblock PER (TEE) monitors privately. When silence becomes truth, execution runs on Devnet. No third party, no bridges.
              </p>
              <Link href="/create" className="mt-10 inline-block btn-primary rounded-full px-10 py-4 text-sm">
                Create Your Capsule
              </Link>
            </div>
            <div
              data-gsap-unleash-3d
              className="relative aspect-video max-w-lg overflow-hidden"
            >
              <AsciiCapsule bgColor="transparent" />
            </div>
          </div>
        </div>
      </section>

      <div className="glow-line" />

      {/* Partners */}
      <section ref={partnersSectionRef} className="partners-section relative py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="font-display text-center text-3xl font-bold uppercase tracking-tight text-Heres-white sm:text-4xl lg:text-5xl">
            The Possibilities Are Limitless
          </h2>
          <p className="mx-auto mt-1 text-center font-display text-lg uppercase tracking-wide text-Heres-accent/60">
            All On Solana
          </p>
          <p className="mx-auto mt-5 max-w-2xl text-center text-Heres-muted">
            Heres uses Solana for persistence, Magicblock PER (TEE) for private execution, Helius for RPC, Phantom and Backpack for wallets, and Solana Mobile Seeker for the APK.
          </p>
        </div>
        <div className="partners-content relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="partners-orbit relative flex min-h-[420px] sm:min-h-[520px] items-center justify-center overflow-hidden">
            {/* Orbit paths */}
            <div className="partners-orbit-rings absolute inset-0 flex items-center justify-center" aria-hidden>
              <div className="absolute h-[320px] w-[480px] rounded-full border border-white/[0.04]" />
              <div className="absolute h-[440px] w-[660px] rounded-full border border-white/[0.04]" />
              <div className="absolute h-[560px] w-[840px] rounded-full border border-white/[0.04]" />
            </div>
            {/* Orbiting logos */}
            {[
              { radiusX: 240, radiusY: 160, count: 4, duration: 22, reverse: false },
              { radiusX: 330, radiusY: 220, count: 8, duration: 28, reverse: true },
              { radiusX: 420, radiusY: 280, count: 12, duration: 35, reverse: false },
            ].map((ring, ringIdx) => (
              <div
                key={ringIdx}
                className="partners-orbit-ring absolute left-1/2 top-1/2 h-0 w-0 origin-center"
                style={{
                  animation: `orbitSpin ${ring.duration}s linear infinite`,
                  animationDirection: ring.reverse ? 'reverse' : 'normal',
                } as React.CSSProperties}
              >
                {(() => {
                  const partners = [
                    { name: 'Solana', href: 'https://solana.com', color: '#9945FF', logo: '/logos/solana.svg' },
                    { name: 'Solana Mobile Seeker', href: 'https://seeker.solanamobile.com', color: '#ffffff', logo: '/logos/solana-mobile-seeker.png' },
                    { name: 'Phantom', href: 'https://phantom.app', color: '#ab9ff2', logo: '/logos/phantom.svg' },
                    { name: 'Helius', href: 'https://helius.dev', color: '#f97316', logo: '/logos/helius.svg' },
                    { name: 'Backpack', href: 'https://backpack.app', color: '#E33E3F', logo: '/logos/backpack.png' },
                    { name: 'Magicblock', href: 'https://www.magicblock.xyz', color: '#22d3ee', logo: '/logos/magicblock.svg' },
                  ]
                  const items = Array.from({ length: ring.count }, (_, i) => partners[i % partners.length])
                  return items.map((p, i) => {
                    const angleDeg = (360 / ring.count) * i
                    const angleRad = (angleDeg * Math.PI) / 180
                    const x = Math.round(ring.radiusX * Math.sin(angleRad))
                    const y = Math.round(-ring.radiusY * Math.cos(angleRad))
                    return (
                      <a
                        key={`${ringIdx}-${i}`}
                        href={p.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="partners-orbit-item absolute left-0 top-0 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-xl border bg-Heres-surface/60 backdrop-blur-sm transition-all duration-300 hover:scale-110 hover:border-Heres-accent/30"
                        style={{
                          transform: `translate(${x}px, ${y}px) rotate(${-angleDeg}deg)`,
                          borderColor: `${p.color}30`,
                        }}
                      >
                        <Image
                          src={p.logo}
                          alt={p.name}
                          width={36}
                          height={36}
                          className="h-full w-full object-contain p-0.5"
                          unoptimized
                        />
                      </a>
                    )
                  })
                })()}
              </div>
            ))}
            {/* Central content */}
            <div className="relative z-10 max-w-lg text-center">
              <h2 className="font-display text-6xl font-bold tracking-tight text-white sm:text-7xl lg:text-8xl">
                5+
              </h2>
              <h3 className="mt-2 font-display text-xl font-semibold uppercase tracking-wide text-white/60 sm:text-2xl">
                Powered by
              </h3>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

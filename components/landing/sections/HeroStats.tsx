'use client'

import { useEffect, useState } from 'react'
import { Box, ShieldCheck, Activity, CheckCircle2 } from 'lucide-react'
import type { HeroStatsData } from '@/lib/landing-stats'

// Live protocol stats for the hero panel. Values are fetched and cached on the
// server (see lib/landing-stats), passed in as props, then counted up from zero
// on mount for an incremental reveal. No client fetch happens here.

const LAMPORTS_PER_SOL = 1_000_000_000
const COUNT_MS = 1400

// Animate a number from 0 to `target` once mount data is available. All state
// updates happen inside the rAF callback (never synchronously in the effect),
// and reduced-motion snaps straight to the final value.
function useCountUp(target: number, run: boolean): number {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!run) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reduce ? 0 : COUNT_MS
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)
    let raf = 0
    let start = 0
    const step = (now: number) => {
      if (!start) start = now
      const p = duration === 0 ? 1 : Math.min(1, (now - start) / duration)
      setValue(target * ease(p))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, run])
  return value
}

const formatCount = (value: number) => Math.max(0, Math.round(value)).toLocaleString('en-US')

export function HeroStats({ initial }: { initial: HeroStatsData | null }) {
  const run = initial !== null
  const created = useCountUp(initial?.total ?? 0, run)
  const securedSol = useCountUp((initial?.securedLamports ?? 0) / LAMPORTS_PER_SOL, run)
  const active = useCountUp(initial?.active ?? 0, run)
  const settled = useCountUp(initial?.executed ?? 0, run)

  const tiles = [
    { key: 'created', label: 'Capsules Created', Icon: Box, value: run ? formatCount(created) : '--' },
    { key: 'secured', label: 'Value Secured', Icon: ShieldCheck, value: run ? securedSol.toFixed(2) : '--', unit: 'SOL' },
    { key: 'active', label: 'Active Capsules', Icon: Activity, value: run ? formatCount(active) : '--' },
    { key: 'settled', label: 'Settled', Icon: CheckCircle2, value: run ? formatCount(settled) : '--' },
  ]

  return (
    <div className="hero__stats" role="list" aria-label="Protocol statistics">
      {tiles.map(({ key, label, Icon, value, unit }) => (
        <div className="hero__stat" role="listitem" key={key}>
          <Icon className="hero__stat-ico" aria-hidden />
          <div className="hero__stat-label">{label}</div>
          <div className={`hero__stat-val tnum${run ? '' : ' is-pending'}`}>
            {value}
            {unit && run ? <span className="hero__stat-unit">{unit}</span> : null}
          </div>
          <span className="hero__stat-bar" aria-hidden />
        </div>
      ))}
    </div>
  )
}

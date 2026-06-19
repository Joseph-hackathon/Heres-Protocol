import { unstable_cache } from 'next/cache'
import { getCapsulesSummary } from '@/lib/dashboard'

// Protocol-wide stats shown on the marketing hero. Only aggregates that hold for
// the whole protocol live here -- never per-capsule values like a single wallet's
// last activity or inactivity window, which differ from capsule to capsule.
export type HeroStatsData = {
  total: number
  securedLamports: number
  active: number
  executed: number
}

// One RPC-backed summary is computed and reused for up to an hour across every
// visitor, instead of recomputing it on each landing-page view. The marketing
// page does not need second-fresh numbers, so an hourly snapshot is plenty.
const loadHeroStats = unstable_cache(
  async (): Promise<HeroStatsData> => {
    const { summary } = await getCapsulesSummary(false)
    return {
      total: summary.total,
      securedLamports: summary.activeValueLockedLamports,
      active: summary.active,
      executed: summary.executed,
    }
  },
  ['landing-hero-stats-v2'],
  { revalidate: 3600, tags: ['landing-hero-stats-v2'] }
)

// Never let a stats hiccup break the landing render: on any failure we return
// null and the hero shows neutral placeholders until the next revalidation.
export async function getHeroStats(): Promise<HeroStatsData | null> {
  try {
    return await loadHeroStats()
  } catch {
    return null
  }
}

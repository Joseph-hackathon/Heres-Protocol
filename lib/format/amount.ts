const LAMPORTS_PER_SOL = 1_000_000_000

/**
 * Format a numeric amount for display. Groups thousands and fixes decimals.
 * Pair with the `.tnum` class (tabular numerals) at the call site for aligned
 * columns. Pass `signed` to force a leading + on non-negative values.
 */
export function formatAmount(
  value: number,
  opts: { decimals?: number; symbol?: string; signed?: boolean } = {}
): string {
  const decimals = opts.decimals ?? 4
  if (!Number.isFinite(value)) return opts.symbol ? `0 ${opts.symbol}` : '0'
  const body = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  const sign = opts.signed && value >= 0 ? '+' : ''
  return opts.symbol ? `${sign}${body} ${opts.symbol}` : `${sign}${body}`
}

/** Signed percentage delta, e.g. +1.2% / -3.4%. Always shows the sign. */
export function formatDelta(pct: number, decimals = 1): string {
  if (!Number.isFinite(pct)) return '0%'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(decimals)}%`
}

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL
}

/** Lamports -> a display SOL string (default 4 decimals, no symbol). */
export function formatSol(lamports: number, decimals = 4): string {
  return formatAmount(lamportsToSol(lamports), { decimals })
}

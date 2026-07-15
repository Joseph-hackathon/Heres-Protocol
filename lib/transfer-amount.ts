/**
 * Convert a human decimal amount to integer base units without floating-point
 * arithmetic. Scientific notation, signs, and excess precision are rejected.
 */
export function parseTransferAmount(value: string, decimals: number): bigint | null {
  const raw = value.trim()
  if (!Number.isInteger(decimals) || decimals < 0 || !/^\d+(\.\d+)?$/.test(raw)) return null

  const [whole, fraction = ''] = raw.split('.')
  if (fraction.length > decimals) return null

  const units = BigInt(`${whole}${fraction.padEnd(decimals, '0')}`)
  return units > 0n ? units : null
}

/** Format integer base units as an exact, editable decimal string. */
export function formatTransferAmount(units: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error('Invalid token decimals')
  if (units < 0n) throw new Error('Transfer amount cannot be negative')
  if (decimals === 0) return units.toString()

  const padded = units.toString().padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

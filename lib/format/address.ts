/**
 * Canonical address masking. Replaces the three near-duplicate maskAddress
 * impls (dashboard 4+4, capsule-detail 8+8, create inline) with one helper
 * that takes head/tail so callers pick the density they need.
 */
export function maskAddress(
  address: string | null | undefined,
  opts: { head?: number; tail?: number } = {}
): string {
  if (!address) return ''
  const head = opts.head ?? 4
  const tail = opts.tail ?? 4
  if (address.length <= head + tail + 1) return address
  return `${address.slice(0, head)}...${address.slice(-tail)}`
}

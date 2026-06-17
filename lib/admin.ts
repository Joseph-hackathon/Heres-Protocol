import { PublicKey } from '@solana/web3.js'

/**
 * Allowlist of wallets permitted to use the admin explorer.
 *
 * Public keys are NOT secret -- the real security boundary is the server-side
 * signature check (see lib/admin-auth.ts), not the secrecy of this list. The
 * allowlist only decides which signed requests are accepted.
 *
 * Resolution: if NEXT_PUBLIC_ADMIN_WALLETS is set (comma-separated base58 keys)
 * it REPLACES the defaults entirely, giving full control in production. When it
 * is unset, the built-in defaults below apply.
 */
const DEFAULT_ADMIN_WALLETS = [
  'Ei8xZgRrMt4eG7FRZ23dixokBCZYbGQVnk4DztpRkCVh', // primary admin
  '4J1h72kmSzh3pJKPV4fMj4ffXFKg5D7qQoUkxPLa3UEx', // test-only, remove before production
]

function parseAdminWallets(): Set<string> {
  const fromEnv = (process.env.NEXT_PUBLIC_ADMIN_WALLETS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const source = fromEnv.length > 0 ? fromEnv : DEFAULT_ADMIN_WALLETS
  const normalized = new Set<string>()
  for (const entry of source) {
    try {
      // Normalize and validate: drop anything that is not a real base58 pubkey.
      normalized.add(new PublicKey(entry).toBase58())
    } catch {
      // Skip malformed entries silently rather than crashing the allowlist.
    }
  }
  return normalized
}

export const ADMIN_WALLETS = parseAdminWallets()

/** True when the given pubkey is on the admin allowlist. Safe on the client. */
export function isAdminWallet(pubkey: string | PublicKey | null | undefined): boolean {
  if (!pubkey) return false
  try {
    const base58 = typeof pubkey === 'string' ? new PublicKey(pubkey).toBase58() : pubkey.toBase58()
    return ADMIN_WALLETS.has(base58)
  } catch {
    return false
  }
}

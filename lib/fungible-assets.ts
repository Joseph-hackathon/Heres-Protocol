import type { PublicKey } from '@solana/web3.js'

export const SOL_ASSET_KEY = 'sol'
export const MAX_FUNGIBLE_ASSETS = 8
// 0.05 SOL program fee plus a conservative 0.03 SOL allowance for capsule/delegation account rent
// and transaction fees. Creation validation treats only the remainder as depositable.
export const CAPSULE_CREATION_SOL_RESERVE_LAMPORTS = 80_000_000n

export function spendableSolLamports(balanceLamports: number | null): bigint | null {
  if (balanceLamports == null) return null
  const balance = BigInt(Math.max(0, Math.floor(balanceLamports)))
  return balance > CAPSULE_CREATION_SOL_RESERVE_LAMPORTS
    ? balance - CAPSULE_CREATION_SOL_RESERVE_LAMPORTS
    : 0n
}

export type WalletFungibleAsset = {
  key: string
  mint: string | null
  decimals: number
  symbol: string
  balanceUi: number | null
  balanceBaseUnits: bigint | null
  tokenProgram: string | null
}

export type SelectedFungibleAsset = WalletFungibleAsset & {
  amount: string
}

/**
 * Convert a human decimal amount to integer base units without passing through a floating-point
 * number. Returns null for blanks, signs, exponent notation, zero, or excess decimal places.
 */
export function parseDecimalToBaseUnits(value: string, decimals: number): bigint | null {
  const raw = value.trim()
  if (!/^\d+(\.\d+)?$/.test(raw) || !Number.isInteger(decimals) || decimals < 0) return null
  const [intPart, fracPart = ''] = raw.split('.')
  if (fracPart.length > decimals) return null
  const units = BigInt(`${intPart}${fracPart.padEnd(decimals, '0')}`)
  return units > 0n ? units : null
}

/** Format raw token units without losing precision in Number conversion. */
export function formatBaseUnits(amount: bigint, decimals: number, maxFractionDigits = decimals): string {
  if (decimals <= 0) return amount.toString()
  const negative = amount < 0n
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, -decimals)
  const fraction = digits
    .slice(-decimals)
    .slice(0, Math.max(0, maxFractionDigits))
    .replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/**
 * cancel_capsule can close one vault token account. Every earlier mint must be recovered first so
 * its ATA is closed before the vault PDA is closed.
 */
export function planMultiMintCancellation<T extends PublicKey | string>(mints: T[]): {
  recoverFirst: T[]
  cancelWith: T | null
} {
  if (mints.length === 0) return { recoverFirst: [], cancelWith: null }
  return {
    recoverFirst: mints.slice(0, -1),
    cancelWith: mints[mints.length - 1],
  }
}

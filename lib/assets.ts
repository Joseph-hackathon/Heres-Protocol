import { PublicKey } from '@solana/web3.js'
import { getAssetMintFromEnv } from '../constants/index.ts'

export type SupportedAssetSymbol = 'SOL' | 'BTC' | 'ETH' | 'MSOL'

export type AssetConfig = {
  symbol: SupportedAssetSymbol
  label: string
  mint: string | null
  decimals: number
  coingeckoId: string
  isNative: boolean
}

type AssetIntentLike = {
  assetSymbol?: unknown
  assetMint?: unknown
}

export type AssetAmountInput = {
  assetSymbol?: unknown
  assetMint?: unknown
}

function normalizeMint(mint: string | null | undefined): string | null {
  if (!mint || !mint.trim()) return null
  return mint.trim()
}

export const ASSET_REGISTRY: Record<SupportedAssetSymbol, AssetConfig> = {
  SOL: {
    symbol: 'SOL',
    label: 'Solana',
    mint: null,
    decimals: 9,
    coingeckoId: 'solana',
    isNative: true,
  },
  BTC: {
    symbol: 'BTC',
    label: 'Bitcoin',
    mint: normalizeMint(getAssetMintFromEnv('BTC')),
    decimals: 8,
    coingeckoId: 'bitcoin',
    isNative: false,
  },
  ETH: {
    symbol: 'ETH',
    label: 'Ethereum',
    mint: normalizeMint(getAssetMintFromEnv('ETH')),
    decimals: 8,
    coingeckoId: 'ethereum',
    isNative: false,
  },
  MSOL: {
    symbol: 'MSOL',
    label: 'Marinade Staked SOL',
    mint: normalizeMint(getAssetMintFromEnv('MSOL')),
    decimals: 9,
    coingeckoId: 'msol',
    isNative: false,
  },
}

export const SUPPORTED_TOKEN_ASSETS = (Object.keys(ASSET_REGISTRY) as SupportedAssetSymbol[]).map(
  (symbol) => ASSET_REGISTRY[symbol]
)

// CONTRACT COUPLING (audit follow-up): on-chain distribute_assets / send_ccip_from_vault infer an
// asset's decimals from assetSymbol via infer_asset_decimals (programs/heres_program/src/utils.rs),
// NOT from the mint account. ASSET_REGISTRY decimals MUST equal that on-chain guess, or every payout
// for the asset is scaled by 10^(delta). This tripwire fails loudly at module load if they drift so
// a new asset cannot silently corrupt distributions. The proper fix is to make the program read
// mint.decimals (needs redeploy + re-audit); until then keep both sides in sync.
const ON_CHAIN_ASSUMED_DECIMALS: Record<SupportedAssetSymbol, number> = {
  SOL: 9,
  BTC: 8,
  ETH: 8,
  MSOL: 9,
}

for (const symbol of Object.keys(ASSET_REGISTRY) as SupportedAssetSymbol[]) {
  if (ASSET_REGISTRY[symbol].decimals !== ON_CHAIN_ASSUMED_DECIMALS[symbol]) {
    throw new Error(
      `Asset ${symbol} decimals (${ASSET_REGISTRY[symbol].decimals}) disagree with on-chain ` +
        `infer_asset_decimals (${ON_CHAIN_ASSUMED_DECIMALS[symbol]}). Update the contract or the registry.`
    )
  }
}

export function getAssetConfig(symbol: SupportedAssetSymbol): AssetConfig {
  return ASSET_REGISTRY[symbol]
}

export function isAssetConfigured(symbol: SupportedAssetSymbol): boolean {
  const asset = getAssetConfig(symbol)
  return asset.isNative || Boolean(asset.mint)
}

export function isSupportedAssetSymbol(value: unknown): value is SupportedAssetSymbol {
  return typeof value === 'string' && value in ASSET_REGISTRY
}

export function getAssetMintPublicKey(symbol: SupportedAssetSymbol): PublicKey | undefined {
  const mint = ASSET_REGISTRY[symbol].mint
  if (!mint) return undefined
  return new PublicKey(mint)
}

export function inferAssetConfig(input?: AssetIntentLike | null, fallbackMint?: PublicKey | null): AssetConfig {
  const intentSymbol = isSupportedAssetSymbol(input?.assetSymbol) ? input.assetSymbol : null
  if (intentSymbol) {
    const config = getAssetConfig(intentSymbol)
    if (typeof input?.assetMint === 'string' && input.assetMint.trim()) {
      return { ...config, mint: input.assetMint.trim() }
    }
    return config
  }

  if (fallbackMint && !fallbackMint.equals(PublicKey.default)) {
    const mintBase58 = fallbackMint.toBase58()
    const matched = SUPPORTED_TOKEN_ASSETS.find((asset) => asset.mint === mintBase58)
    if (matched) return matched
  }

  return getAssetConfig('SOL')
}

export function getAssetDecimals(input?: AssetAmountInput | null, fallbackMint?: PublicKey | null): number {
  return inferAssetConfig(input, fallbackMint).decimals
}

// Strict amount-string validator. Mirrors the on-chain parser exactly
// (programs/heres_program/src/utils.rs::parse_amount_to_units, audit M1): digits with at most one
// '.', no sign, no exponent, no whitespace. Use before encodeIntentData so the client rejects what
// the program will reject, instead of failing on-chain after a wallet signature.
const AMOUNT_RE = /^\d+(\.\d+)?$/

export function isValidAmountString(amount: string): boolean {
  return AMOUNT_RE.test(amount.trim())
}

export function toAtomicAmount(
  amount: string | number,
  input?: AssetAmountInput | null,
  fallbackMint?: PublicKey | null
): bigint {
  const raw = typeof amount === 'number' ? String(amount) : amount.trim()
  if (!raw) throw new Error('Amount is required')
  if (!AMOUNT_RE.test(raw)) throw new Error(`Invalid amount: ${amount}`)

  const decimals = getAssetDecimals(input, fallbackMint)
  const [wholePart, fractionalPart = ''] = raw.split('.')
  const normalizedFraction = fractionalPart.padEnd(decimals, '0')

  if (fractionalPart.length > decimals) {
    throw new Error(`Too many decimal places for asset with ${decimals} decimals`)
  }

  return BigInt(wholePart || '0') * (10n ** BigInt(decimals)) + BigInt(normalizedFraction || '0')
}

import { PublicKey } from '@solana/web3.js'
import { getAssetMintFromEnv } from '../constants/index.ts'

export type AssetNetwork = 'solana' | 'stellar'
export type SupportedAssetSymbol = 'SOL' | 'BTC' | 'ETH' | 'MSOL' | 'AUDD' | 'XLM'

export type StellarAssetConfig = {
  code: string
  issuer: string | null
  native: boolean
}

export type AssetConfig = {
  symbol: SupportedAssetSymbol
  label: string
  mint: string | null
  decimals: number
  coingeckoId: string
  isNative: boolean
  networks: AssetNetwork[]
  stellar?: StellarAssetConfig
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
    networks: ['solana'],
  },
  BTC: {
    symbol: 'BTC',
    label: 'Bitcoin',
    mint: normalizeMint(getAssetMintFromEnv('BTC')),
    decimals: 8,
    coingeckoId: 'bitcoin',
    isNative: false,
    networks: ['solana', 'stellar'],
    stellar: {
      code: process.env.NEXT_PUBLIC_STELLAR_BTC_CODE || 'BTC',
      issuer: process.env.NEXT_PUBLIC_STELLAR_BTC_ISSUER || null,
      native: false,
    },
  },
  ETH: {
    symbol: 'ETH',
    label: 'Ethereum',
    mint: normalizeMint(getAssetMintFromEnv('ETH')),
    decimals: 8,
    coingeckoId: 'ethereum',
    isNative: false,
    networks: ['solana', 'stellar'],
    stellar: {
      code: process.env.NEXT_PUBLIC_STELLAR_ETH_CODE || 'ETH',
      issuer: process.env.NEXT_PUBLIC_STELLAR_ETH_ISSUER || null,
      native: false,
    },
  },
  MSOL: {
    symbol: 'MSOL',
    label: 'Marinade Staked SOL',
    mint: normalizeMint(getAssetMintFromEnv('MSOL')),
    decimals: 9,
    coingeckoId: 'msol',
    isNative: false,
    networks: ['solana'],
  },
  AUDD: {
    symbol: 'AUDD',
    label: 'Australian Digital Dollar (solAUDD)',
    mint: normalizeMint(getAssetMintFromEnv('AUDD')),
    decimals: 6,
    coingeckoId: 'novatti-australian-digital-dollar',
    isNative: false,
    networks: ['solana', 'stellar'],
    stellar: {
      code: process.env.NEXT_PUBLIC_STELLAR_AUDD_CODE || 'AUDD',
      issuer: process.env.NEXT_PUBLIC_STELLAR_AUDD_ISSUER || null,
      native: false,
    },
  },
  XLM: {
    symbol: 'XLM',
    label: 'Stellar Lumens',
    mint: null,
    decimals: 7,
    coingeckoId: 'stellar',
    isNative: false,
    networks: ['stellar'],
    stellar: {
      code: 'XLM',
      issuer: null,
      native: true,
    },
  },
}

export const SUPPORTED_TOKEN_ASSET_SYMBOLS: SupportedAssetSymbol[] = ['BTC', 'ETH', 'SOL', 'AUDD', 'XLM']

export const SUPPORTED_TOKEN_ASSETS = SUPPORTED_TOKEN_ASSET_SYMBOLS.map(
  (symbol) => ASSET_REGISTRY[symbol]
)

export function getAssetConfig(symbol: SupportedAssetSymbol): AssetConfig {
  return ASSET_REGISTRY[symbol]
}

export function isAssetConfigured(symbol: SupportedAssetSymbol): boolean {
  return isSolanaAssetConfigured(symbol) || isStellarIssuerConfigured(symbol)
}

export function isSolanaAssetConfigured(symbol: SupportedAssetSymbol): boolean {
  const asset = getAssetConfig(symbol)
  return asset.networks.includes('solana') && (asset.isNative || Boolean(asset.mint))
}

export function getAssetNetworkLabels(symbol: SupportedAssetSymbol): string {
  const asset = getAssetConfig(symbol)
  return asset.networks
    .map((network) => (network === 'solana' ? 'Solana' : 'Stellar'))
    .join(' / ')
}

export function isStellarIssuerConfigured(symbol: SupportedAssetSymbol): boolean {
  const asset = getAssetConfig(symbol)
  if (!asset.networks.includes('stellar')) return false
  if (asset.stellar?.native) return true
  return Boolean(asset.stellar?.issuer)
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

export function toAtomicAmount(
  amount: string | number,
  input?: AssetAmountInput | null,
  fallbackMint?: PublicKey | null
): bigint {
  const raw = typeof amount === 'number' ? String(amount) : amount.trim()
  if (!raw) throw new Error('Amount is required')
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`Invalid amount: ${amount}`)

  const decimals = getAssetDecimals(input, fallbackMint)
  const [wholePart, fractionalPart = ''] = raw.split('.')
  const normalizedFraction = fractionalPart.padEnd(decimals, '0')

  if (fractionalPart.length > decimals) {
    throw new Error(`Too many decimal places for asset with ${decimals} decimals`)
  }

  return BigInt(wholePart || '0') * (10n ** BigInt(decimals)) + BigInt(normalizedFraction || '0')
}

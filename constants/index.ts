/**
 * Application constants
 */

import idl from '@/idl/heres_program.json'

export type SolanaNetwork = 'devnet' | 'testnet' | 'mainnet-beta'

const KNOWN_DEVNET_ASSET_MINTS: Partial<Record<string, string>> = {
  MSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
}

function normalizeSolanaNetwork(value: string | undefined): SolanaNetwork {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'mainnet' || normalized === 'mainnet-beta') return 'mainnet-beta'
  if (normalized === 'testnet') return 'testnet'
  return 'devnet'
}

function getDefaultSolanaRpcUrl(network: SolanaNetwork): string {
  switch (network) {
    case 'mainnet-beta':
      return 'https://api.mainnet-beta.solana.com'
    case 'testnet':
      return 'https://api.testnet.solana.com'
    case 'devnet':
    default:
      return 'https://api.devnet.solana.com'
  }
}

function getDefaultHeliusRpcUrl(network: SolanaNetwork, apiKey: string): string {
  const subdomain = network === 'mainnet-beta' ? 'mainnet' : network
  return `https://${subdomain}.helius-rpc.com/?api-key=${apiKey}`
}

function getDefaultHeliusApiBaseUrl(network: SolanaNetwork): string {
  const subdomain = network === 'mainnet-beta' ? 'mainnet' : network
  return `https://api-${subdomain}.helius-rpc.com/v0`
}

export function getAssetMintEnvKey(symbol: string): string {
  return `NEXT_PUBLIC_${symbol}_MINT`
}

export function getAssetMintFromEnv(symbol: string): string | null {
  // Next.js only exposes NEXT_PUBLIC_* values reliably in client bundles when accessed statically.
  // Avoid dynamic process.env[key] lookups here or token mints will appear unset in the browser UI.
  let value: string | undefined
  switch (symbol) {
    case 'BTC':
      value = process.env.NEXT_PUBLIC_BTC_MINT || process.env.NEXT_PUBLIC_BTC_DEVNET_MINT
      break
    case 'ETH':
      value = process.env.NEXT_PUBLIC_ETH_MINT || process.env.NEXT_PUBLIC_ETH_DEVNET_MINT
      break
    case 'MSOL':
      value = process.env.NEXT_PUBLIC_MSOL_MINT || process.env.NEXT_PUBLIC_MSOL_DEVNET_MINT
      break
    default:
      value = process.env[getAssetMintEnvKey(symbol)]
      break
  }
  if (value && value.trim()) return value.trim()

  const network = normalizeSolanaNetwork(process.env.NEXT_PUBLIC_SOLANA_NETWORK)
  if (network === 'devnet') {
    return KNOWN_DEVNET_ASSET_MINTS[symbol] || null
  }
  return null
}

export function getExplorerUrl(path: 'address' | 'tx', value: string, network = SOLANA_CONFIG.NETWORK): string {
  const url = new URL(`https://explorer.solana.com/${path}/${value}`)
  if (network !== 'mainnet-beta') {
    url.searchParams.set('cluster', network)
  }
  return url.toString()
}

export function getNetworkDisplayLabel(network = SOLANA_CONFIG.NETWORK): string {
  switch (network) {
    case 'mainnet-beta':
      return 'Solana Mainnet'
    case 'testnet':
      return 'Solana Testnet'
    case 'devnet':
    default:
      return 'Solana Devnet'
  }
}

// Solana Configuration
export const SOLANA_CONFIG = {
  NETWORK: normalizeSolanaNetwork(process.env.NEXT_PUBLIC_SOLANA_NETWORK),
  // Single source of truth: the program's declare_id!, surfaced via the IDL that anchor build
  // regenerates. Do NOT read this from env - that lets a deployed env (Vercel) silently drift
  // from the program the IDL was built against. On a new-keypair deploy, update declare_id! and
  // rebuild; the new address flows here automatically.
  PROGRAM_ID: idl.address,
  // Display-only. Aggregate dashboard + landing-hero stats are read from an earlier
  // high-activity deploy so the public numbers reflect the protocol's full history
  // rather than the fresh lean program. This NEVER affects functional flows
  // (create/delegate/execute) - those always use PROGRAM_ID above. Override with
  // DASHBOARD_STATS_PROGRAM_ID; set it to PROGRAM_ID's value to show live-program stats.
  STATS_PROGRAM_ID: process.env.DASHBOARD_STATS_PROGRAM_ID || '26pDfWXnq9nm1Y5J6siwQsVfHXKxKo5vKvRMVCpqXms6',
  HELIUS_API_KEY: process.env.NEXT_PUBLIC_HELIUS_API_KEY || '',
    RPC_URL: process.env.SOLANA_RPC_URL || '',
    FALLBACK_RPC_URL:
      process.env.SOLANA_FALLBACK_RPC_URL ||
      process.env.NEXT_PUBLIC_SOLANA_FALLBACK_RPC_URL ||
      getDefaultSolanaRpcUrl(normalizeSolanaNetwork(process.env.NEXT_PUBLIC_SOLANA_NETWORK)),
    /** Platform wallet for the one-time creation fee */
    PLATFORM_FEE_RECIPIENT: process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT || 'Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb',
    // Relayer / crank wallet pubkey. Doubles as the default heartbeat_authority on new capsules so the
    // off-chain liveness service can bump last_activity. MUST match the keypair behind
    // CRANK_WALLET_PRIVATE_KEY (the heartbeat tx signer + the interact-only TEE permission member);
    // a mismatch silently breaks heartbeats and the switch fires on a living owner. Default = the live
    // devnet relayer (3Xjbnum...), not a placeholder.
    CRANK_WALLET_PUBLIC_KEY: process.env.NEXT_PUBLIC_CRANK_WALLET_PUBLIC_KEY || '3XjbnUmCRfq6tHZCfXuDSMKoapyxj9pnkaJSTVRfcEqd',
    USE_MAGICBLOCK_PRIVATE_PAYMENTS: process.env.USE_MAGICBLOCK_PRIVATE_PAYMENTS === '1',
    MAGICBLOCK_PRIVATE_PAYMENTS_BASE_URL: process.env.MAGICBLOCK_PRIVATE_PAYMENTS_BASE_URL || 'https://payments.magicblock.app',
    MAGICBLOCK_PRIVATE_PAYMENTS_API_KEY: process.env.MAGICBLOCK_PRIVATE_PAYMENTS_API_KEY || '',
  } as const

// Helius API Configuration
export const HELIUS_CONFIG = {
  BASE_URL: getDefaultHeliusApiBaseUrl(SOLANA_CONFIG.NETWORK),
  RPC_URL: SOLANA_CONFIG.RPC_URL
    ? SOLANA_CONFIG.RPC_URL
    : SOLANA_CONFIG.HELIUS_API_KEY
      ? getDefaultHeliusRpcUrl(SOLANA_CONFIG.NETWORK, SOLANA_CONFIG.HELIUS_API_KEY)
      : getDefaultSolanaRpcUrl(SOLANA_CONFIG.NETWORK),
  RPC_URL_ALT: SOLANA_CONFIG.FALLBACK_RPC_URL || getDefaultSolanaRpcUrl(SOLANA_CONFIG.NETWORK),
  PUBLIC_RPC_URL: getDefaultSolanaRpcUrl(SOLANA_CONFIG.NETWORK),
} as const

// Default Values
export const DEFAULT_VALUES = {
  INACTIVITY_DAYS: '365',
  DELAY_DAYS: '30',
} as const

/** Default one-time capsule creation fee. The program does not charge an execution fee. */
export const PLATFORM_FEE = {
  CREATION_FEE_SOL: 0.05,
  CREATION_FEE_LAMPORTS: 50_000_000,
} as const

// Magicblock ER (Ephemeral Rollup) - Devnet validators
export const MAGICBLOCK_ER = {
  DELEGATION_PROGRAM_ID: 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh',
  MAGIC_PROGRAM_ID: process.env.NEXT_PUBLIC_MAGIC_PROGRAM_ID || 'Magic11111111111111111111111111111111111111',
  // The buffer/delegation PDAs are owned by our program, so this is always the program ID.
  BUFFER_SEED_PROGRAM_ID: idl.address,
  MAGIC_CONTEXT: process.env.NEXT_PUBLIC_MAGIC_CONTEXT || 'MagicContext1111111111111111111111111111111',
  ER_RPC_URL: process.env.NEXT_PUBLIC_ER_RPC_URL || 'https://devnet-as.magicblock.app',
  ER_WS_URL: process.env.NEXT_PUBLIC_ER_WS_URL || 'wss://devnet-as.magicblock.app',
  ROUTER_DEVNET: 'https://devnet-router.magicblock.app',
  ROUTER_WS: 'wss://devnet-router.magicblock.app',
  ACTIVE_VALIDATOR: process.env.NEXT_PUBLIC_ER_VALIDATOR || 'MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57',
  VALIDATOR_ASIA: 'MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57',
  VALIDATOR_EU: 'MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e',
  VALIDATOR_US: 'MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd',
  // Must match the on-chain constants.rs TEE_VALIDATOR. delegate_capsule defaults to this when no
  // validator is passed; the create flow delegates the Switch here so its ER copy lives on the TEE node.
  VALIDATOR_TEE: 'MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo',
  PERMISSION_PROGRAM_ID: 'ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1',
  CRANK_DEFAULT_INTERVAL_MS: 10000,
  CRANK_DEFAULT_ITERATIONS: 100_000,
} as const

/**
 * Private Ephemeral Rollup (TEE / Intel TDX) endpoints. The Switch is delegated to the TEE validator,
 * so its ER copy lives on the TEE node behind a per-key auth token (getAuthToken). These default to the
 * proven devnet TEE node (devnet-tee.magicblock.app) used by scripts/magicblock/er-roundtrip.mjs - NOT
 * the regular ER (devnet-as), which does not enforce the permission account / read filtering.
 */
export const PER_TEE = {
  RPC_URL: process.env.NEXT_PUBLIC_TEE_RPC_URL || 'https://devnet-tee.magicblock.app',
  TEE_RPC_URL: process.env.NEXT_PUBLIC_TEE_RPC_URL || 'https://devnet-tee.magicblock.app',
  AUTH_URL: process.env.NEXT_PUBLIC_TEE_AUTH_URL || process.env.NEXT_PUBLIC_TEE_RPC_URL || 'https://devnet-tee.magicblock.app',
  DOCS_URL: 'https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction',
} as const

export const MAX_CAPSULE_MODIFICATIONS = 3

export const STORAGE_KEYS = {
  CAPSULE_INTENT: (address: string, id: string | number) => `capsule_intent_${address}_${id}`,
  CAPSULE_CREATION_TX: (address: string) => `capsule_creation_tx_${address}`,
  CAPSULE_CREATION_TX_WITH_SIG: (address: string, signature: string) => `capsule_creation_tx_${address}_${signature}`,
  CAPSULE_EXECUTION_TX: (address: string) => `capsule_execution_tx_${address}`,
  CAPSULE_EXECUTION_TX_WITH_SIG: (address: string, signature: string) => `capsule_execution_tx_${address}_${signature}`,
  EXECUTED_CAPSULES: (address: string) => `executed_capsules_${address}`,
  CAPSULE_MODIFY_COUNT: (address: string) => `capsule_modify_count_${address}`,
} as const

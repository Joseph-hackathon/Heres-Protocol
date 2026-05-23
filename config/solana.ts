/**
 * Solana configuration and utilities
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { SOLANA_CONFIG, SOLANA_RPC_CONFIG, PER_TEE, MAGICBLOCK_ER } from '@/constants'

let cachedConnection: Connection | null = null
let cachedFallbackConnection: Connection | null = null

/**
 * Get Solana connection with the configured base-layer RPC.
 * Preference order: explicit RPC URL, Alchemy, public cluster RPC.
 */
export function getSolanaConnection(): Connection {
  if (cachedConnection) return cachedConnection

  const rpcUrl = SOLANA_RPC_CONFIG.RPC_URL
  cachedConnection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: SOLANA_RPC_CONFIG.RPC_URL.replace('https', 'wss'),
  })
  return cachedConnection
}

export function getSolanaFallbackConnection(): Connection {
  if (cachedFallbackConnection) return cachedFallbackConnection

  const rpcUrl = SOLANA_RPC_CONFIG.RPC_URL_ALT
  cachedFallbackConnection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: SOLANA_RPC_CONFIG.RPC_URL_ALT.replace('https', 'wss'),
  })
  return cachedFallbackConnection
}

/**
 * Get direct TEE RPC connection for delegated state queries.
 */
export function getTeeConnection(token?: string): Connection {
  const url = token ? `${PER_TEE.RPC_URL}?token=${token}` : PER_TEE.RPC_URL
  return new Connection(url, {
    commitment: 'confirmed',
  })
}

/**
 * Get program ID as PublicKey
 */
export function getProgramId(): PublicKey {
  return new PublicKey(SOLANA_CONFIG.PROGRAM_ID)
}

/**
 * Validate Solana address
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address)
    return true
  } catch {
    return false
  }
}

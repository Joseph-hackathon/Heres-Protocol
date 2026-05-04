/**
 * Helius API integration for real-time on-chain monitoring
 * 
 * Updated to use getTransactionsForAddress RPC method for better performance
 * and advanced filtering capabilities.
 * 
 * @see https://www.helius.dev/docs/rpc/gettransactionsforaddress
 */

import { HELIUS_CONFIG, SOLANA_CONFIG } from '@/constants'
import type { WalletActivity } from '@/types'

/**
 * Interface for getTransactionsForAddress request parameters
 */
export interface GetTransactionsForAddressParams {
  transactionDetails?: 'signatures' | 'full'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  paginationToken?: string
  commitment?: 'finalized' | 'confirmed'
  filters?: {
    slot?: {
      gte?: number
      gt?: number
      lte?: number
      lt?: number
    }
    blockTime?: {
      gte?: number
      gt?: number
      lte?: number
      lt?: number
      eq?: number
    }
    signature?: {
      gte?: string
      gt?: string
      lte?: string
      lt?: string
    }
    status?: 'succeeded' | 'failed'
    tokenAccounts?: 'none' | 'balanceChanged' | 'all'
  }
}

/**
 * Interface for getTransactionsForAddress response
 */
export interface GetTransactionsForAddressResponse {
  data: any[]
  paginationToken?: string
}

/**
 * Get transactions for an address using Helius getTransactionsForAddress RPC method
 * 
 * This is a Helius-exclusive RPC method that provides:
 * - Full transaction data in one call (no need for getTransaction)
 * - Associated Token Accounts (ATA) support
 * - Advanced filtering and sorting
 * - Efficient pagination
 * 
 * @param address - Base-58 encoded public key
 * @param params - Query parameters
 * @returns Transaction data with pagination token
 */
export async function getTransactionsForAddress(
  address: string,
  params: GetTransactionsForAddressParams = {}
): Promise<GetTransactionsForAddressResponse | null> {
  try {
    const {
      transactionDetails = 'signatures',
      sortOrder = 'desc',
      limit = 100,
      paginationToken,
      commitment = 'finalized',
      filters = {},
    } = params

    const rpcUrl = HELIUS_CONFIG.RPC_URL
    if (!rpcUrl) {
      throw new Error('Helius RPC URL not configured')
    }

    const requestBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransactionsForAddress',
      params: [
        address,
        {
          transactionDetails,
          sortOrder,
          limit,
          ...(paginationToken && { paginationToken }),
          commitment,
          ...(Object.keys(filters).length > 0 && { filters }),
        },
      ],
    }

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Helius RPC error: ${response.status} ${response.statusText}`, errorText)
      throw new Error(`Helius RPC error: ${response.statusText}`)
    }

    const data = await response.json()

    if (data.error) {
      const errorCode = data.error.code
      const errorMessage = data.error.message || ''
      
      // Check if it's a paid plan requirement error (403 or -32403)
      if (response.status === 403 || errorCode === -32403 || errorMessage.includes('paid plans') || errorMessage.includes('upgrade')) {
        console.warn('getTransactionsForAddress requires a paid Helius plan. Falling back to Enhanced Transactions API.')
        return null // Return null to trigger fallback
      }
      
      console.error('Helius RPC error:', data.error)
      throw new Error(data.error.message || 'Helius RPC error')
    }

    return data.result || null
  } catch (error: any) {
    // Check if it's a 403 error in the error message
    if (error?.message?.includes('403') || error?.message?.includes('paid plans')) {
      console.warn('getTransactionsForAddress requires a paid Helius plan. Falling back to alternative methods.')
      return null
    }
    console.error('Error fetching transactions from Helius RPC:', error)
    return null
  }
}

/**
 * Get wallet activity information from Helius
 * 
 * Falls back to Enhanced Transactions API if getTransactionsForAddress is not available (requires paid plan)
 */
export async function getWalletActivity(walletAddress: string): Promise<WalletActivity | null> {
  try {
    // Use Enhanced Transactions API (free tier)
    console.log('Fetching wallet activity from Enhanced Transactions API for wallet:', walletAddress)
    const response = await fetch(
      `${HELIUS_CONFIG.BASE_URL}/addresses/${walletAddress}/transactions?api-key=${SOLANA_CONFIG.HELIUS_API_KEY}&limit=100`
    )
    
    if (!response.ok) {
      console.warn(`Enhanced Transactions API error: ${response.status} ${response.statusText}`)
      return {
        wallet: walletAddress,
        lastSignature: '',
        lastActivityTimestamp: 0,
        transactionCount: 0,
      }
    }
    
    const data = await response.json()
    
    // Handle different response formats from Enhanced Transactions API
    let transactions: any[] = []
    if (Array.isArray(data)) {
      transactions = data
    } else if (data && Array.isArray(data.transactions)) {
      transactions = data.transactions
    } else if (data && data.result && Array.isArray(data.result)) {
      transactions = data.result
    } else if (data && data.data && Array.isArray(data.data)) {
      transactions = data.data
    }
    
    if (!transactions || transactions.length === 0) {
      console.log('No transactions found for wallet:', walletAddress)
      return {
        wallet: walletAddress,
        lastSignature: '',
        lastActivityTimestamp: 0,
        transactionCount: 0,
      }
    }
    
    // Sort transactions by timestamp (newest first)
    transactions.sort((a, b) => {
      const timeA = a.timestamp || a.blockTime || a.tx?.blockTime || 0
      const timeB = b.timestamp || b.blockTime || b.tx?.blockTime || 0
      return timeB - timeA
    })
    
    const latestTx = transactions[0]
    
    const signature = latestTx.signature || 
                     latestTx.transactionSignature ||
                     latestTx.transaction?.signatures?.[0] ||
                     latestTx.tx?.signature ||
                     latestTx.signatures?.[0] ||
                     ''
    
    let timestamp = 0
    if (latestTx.timestamp) {
      timestamp = typeof latestTx.timestamp === 'number' 
        ? latestTx.timestamp 
        : parseInt(String(latestTx.timestamp))
    } else if (latestTx.blockTime) {
      timestamp = typeof latestTx.blockTime === 'number'
        ? latestTx.blockTime
        : parseInt(String(latestTx.blockTime))
    } else if (latestTx.tx?.blockTime) {
      timestamp = typeof latestTx.tx.blockTime === 'number'
        ? latestTx.tx.blockTime
        : parseInt(String(latestTx.tx.blockTime))
    }
    
    const timestampMs = timestamp > 1000000000000 ? timestamp : timestamp * 1000
    
    console.log('Helius Enhanced Transactions API response for wallet:', walletAddress, {
      transactionCount: transactions.length,
      latestSignature: signature,
      latestTimestamp: timestampMs,
    })
    
    return {
      wallet: walletAddress,
      lastSignature: signature,
      lastActivityTimestamp: timestampMs,
      transactionCount: transactions.length,
    }
  } catch (error) {
    console.error('Error fetching wallet activity from Helius:', error)
    return null
  }
}

/**
 * Subscribe to wallet activity webhooks (for production use)
 */
export async function createWebhook(
  walletAddress: string,
  webhookUrl: string
): Promise<string | null> {
  try {
    // Note: Webhooks might use different endpoint, but keeping BASE_URL for consistency
    const response = await fetch(`${HELIUS_CONFIG.BASE_URL}/webhooks?api-key=${SOLANA_CONFIG.HELIUS_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhookURL: webhookUrl,
        transactionTypes: ['Any'],
        accountAddresses: [walletAddress],
        webhookType: 'enhanced',
      }),
    })
    
    if (!response.ok) {
      throw new Error(`Helius webhook creation error: ${response.statusText}`)
    }
    
    const data = await response.json()
    return data.webhookID
  } catch (error) {
    console.error('Error creating webhook:', error)
    return null
  }
}

/**
 * Check if wallet has been inactive for a given period
 */
export function isWalletInactive(
  lastActivityTimestamp: number,
  inactivityPeriodSeconds: number
): boolean {
  const now = Date.now()
  const timeSinceActivity = (now - lastActivityTimestamp) / 1000 // Convert to seconds
  return timeSinceActivity >= inactivityPeriodSeconds
}

/** Normalized NFT item from Helius DAS */
export interface HeliusNftItem {
  mint: string
  name?: string
  symbol?: string
  imageUri?: string
}

/**
 * Get NFTs (and other digital assets) by owner via Helius DAS getAssetsByOwner.
 * Use when HELIUS_API_KEY is set for full metadata (name, image).
 * @see https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api/get-assets-by-owner
 */
export async function getAssetsByOwner(ownerAddress: string): Promise<HeliusNftItem[]> {
  if (!SOLANA_CONFIG.HELIUS_API_KEY) return []
  const rpcUrl = HELIUS_CONFIG.RPC_URL
  if (!rpcUrl) return []

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAssetsByOwner',
        params: { ownerAddress },
      }),
    })
    if (!response.ok) return []

    const data = await response.json()
    const result = data.result
    if (!result || !Array.isArray(result.items)) return []

    const items: HeliusNftItem[] = result.items
      .filter((item: any) => item?.interface === 'V1_NFT' || item?.id)
      .map((item: any) => {
        const content = item?.content || {}
        const files = content?.files || []
        const metadata = content?.metadata || {}
        const imageUri = files[0]?.cdn_uri || files[0]?.uri
        return {
          mint: item.id || '',
          name: metadata?.name ?? undefined,
          symbol: metadata?.symbol ?? undefined,
          imageUri: imageUri ?? undefined,
        }
      })
    return items
  } catch (e) {
    console.error('Helius getAssetsByOwner error:', e)
    return []
  }
}

/**
 * Get NFTs by owner (alias for getAssetsByOwner).
 * Use when HELIUS_API_KEY is set for full metadata (name, image).
 */
export async function getNftsByOwner(ownerAddress: string): Promise<HeliusNftItem[]> {
  return getAssetsByOwner(ownerAddress)
}

/**
 * Get transactions for a program/address from Helius Enhanced Transactions API.
 * Use as primary source when HELIUS_API_KEY is set.
 */
export async function getEnhancedTransactions(
  address: string,
  limit = 100,
  before?: string
): Promise<any[]> {
  if (!SOLANA_CONFIG.HELIUS_API_KEY) return []
  try {
    const url = new URL(`${HELIUS_CONFIG.BASE_URL}/addresses/${address}/transactions`)
    url.searchParams.set('api-key', SOLANA_CONFIG.HELIUS_API_KEY)
    url.searchParams.set('limit', String(limit))
    if (before) url.searchParams.set('before', before)
    const response = await fetch(url.toString())
    if (!response.ok) return []
    const data = await response.json()
    const list = Array.isArray(data) ? data : data?.transactions ?? data?.data ?? data?.result ?? []
    return Array.isArray(list) ? list : []
  } catch (e) {
    console.error('Helius getEnhancedTransactions error:', e)
    return []
  }
}

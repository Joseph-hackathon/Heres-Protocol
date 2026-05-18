import 'server-only'

import { PublicKey } from '@solana/web3.js'
import { getSolanaConnection, getSolanaFallbackConnection } from '@/config/solana'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

export type WalletNftItem = {
  mint: string
  name?: string
  symbol?: string
  imageUri?: string
}

export type AddressTransaction = {
  signature: string
  blockTime: number | null
  err: unknown
  tokenTransfers: Array<{ mint: string; delta: string }>
}

async function withFallback<T>(fn: (connection: ReturnType<typeof getSolanaConnection>) => Promise<T>): Promise<T> {
  try {
    return await fn(getSolanaConnection())
  } catch {
    return fn(getSolanaFallbackConnection())
  }
}

export async function getNftsByOwnerViaRpc(ownerAddress: string): Promise<WalletNftItem[]> {
  const owner = new PublicKey(ownerAddress)
  return withFallback(async (connection) => {
    const { value } = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })
    return value
      .filter((account) => {
        const info = account.account.data.parsed?.info
        const tokenAmount = info?.tokenAmount
        if (!tokenAmount) return false
        return Number(tokenAmount.decimals) === 0 && String(tokenAmount.amount) === '1'
      })
      .map((account) => {
        const info = account.account.data.parsed?.info
        const mint = String(info?.mint || '')
        return {
          mint,
          name: mint.slice(0, 4) ? `NFT ${mint.slice(0, 4)}` : undefined,
          symbol: 'NFT',
        }
      })
      .filter((item) => item.mint)
  })
}

function extractTokenTransfers(tx: any): Array<{ mint: string; delta: string }> {
  const preBalances = Array.isArray(tx?.meta?.preTokenBalances) ? tx.meta.preTokenBalances : []
  const postBalances = Array.isArray(tx?.meta?.postTokenBalances) ? tx.meta.postTokenBalances : []
  const balances = new Map<string, { mint: string; pre: bigint; post: bigint }>()

  for (const entry of preBalances) {
    const key = `${entry.accountIndex}:${entry.mint}`
    balances.set(key, {
      mint: String(entry.mint || ''),
      pre: BigInt(entry.uiTokenAmount?.amount || '0'),
      post: 0n,
    })
  }

  for (const entry of postBalances) {
    const key = `${entry.accountIndex}:${entry.mint}`
    const existing = balances.get(key)
    balances.set(key, {
      mint: String(entry.mint || existing?.mint || ''),
      pre: existing?.pre || 0n,
      post: BigInt(entry.uiTokenAmount?.amount || '0'),
    })
  }

  return Array.from(balances.values())
    .map((entry) => ({ mint: entry.mint, delta: (entry.post - entry.pre).toString() }))
    .filter((entry) => entry.mint && entry.delta !== '0')
}

export async function getAddressTransactionsViaRpc(
  address: string,
  limit = 100,
  before?: string
): Promise<AddressTransaction[]> {
  const owner = new PublicKey(address)
  return withFallback(async (connection) => {
    const signatures = await connection.getSignaturesForAddress(owner, {
      limit,
      ...(before ? { before } : {}),
    })

    const transactions = await Promise.all(
      signatures.map(async (signatureInfo) => {
        try {
          const tx = await connection.getTransaction(signatureInfo.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          })
          return {
            signature: signatureInfo.signature,
            blockTime: signatureInfo.blockTime ?? tx?.blockTime ?? null,
            err: signatureInfo.err ?? tx?.meta?.err ?? null,
            tokenTransfers: extractTokenTransfers(tx),
          }
        } catch {
          return {
            signature: signatureInfo.signature,
            blockTime: signatureInfo.blockTime ?? null,
            err: signatureInfo.err ?? null,
            tokenTransfers: [],
          }
        }
      })
    )

    return transactions
  })
}

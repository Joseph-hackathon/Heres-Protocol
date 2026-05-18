import { PublicKey } from '@solana/web3.js'
import { getSolanaConnection } from '@/config/solana'
import { SOLANA_CONFIG } from '@/constants'
import { getAlchemyAssetsByOwner, type AlchemyNftItem } from '@/lib/alchemy'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/

function isValidSolanaSignature(value: string): boolean {
  return SOLANA_SIGNATURE_RE.test(value)
}

function getSignatureFromParsedTx(tx: any): string {
  return (
    tx?.transaction?.signatures?.[0] ||
    tx?.signature ||
    ''
  )
}

function buildTokenTransfers(meta: any, transaction: any): Array<{ mint: string; fromUserAccount?: string; toUserAccount?: string; tokenAmount?: number }> {
  const pre = Array.isArray(meta?.preTokenBalances) ? meta.preTokenBalances : []
  const post = Array.isArray(meta?.postTokenBalances) ? meta.postTokenBalances : []
  const accountKeys = transaction?.message?.accountKeys || []
  const indexed = new Map<number, { pre?: any; post?: any }>()

  for (const entry of pre) {
    if (typeof entry?.accountIndex === 'number') {
      indexed.set(entry.accountIndex, { ...(indexed.get(entry.accountIndex) || {}), pre: entry })
    }
  }
  for (const entry of post) {
    if (typeof entry?.accountIndex === 'number') {
      indexed.set(entry.accountIndex, { ...(indexed.get(entry.accountIndex) || {}), post: entry })
    }
  }

  return Array.from(indexed.entries()).flatMap(([accountIndex, balances]) => {
    const mint = balances.post?.mint || balances.pre?.mint
    if (!mint) return []

    const preAmount = Number(balances.pre?.uiTokenAmount?.uiAmount || 0)
    const postAmount = Number(balances.post?.uiTokenAmount?.uiAmount || 0)
    const delta = postAmount - preAmount
    if (!Number.isFinite(delta) || delta === 0) return []

    const owner = accountKeys[accountIndex]?.pubkey?.toBase58?.() || accountKeys[accountIndex]?.toBase58?.() || undefined
    return [{
      mint,
      fromUserAccount: delta < 0 ? owner : undefined,
      toUserAccount: delta > 0 ? owner : undefined,
      tokenAmount: Math.abs(delta),
    }]
  })
}

export async function getEnhancedTransactions(
  address: string,
  limit = 100,
  before?: string
): Promise<any[]> {
  try {
    const connection = getSolanaConnection()
    const pubkey = new PublicKey(address)
    const signatures = await connection.getSignaturesForAddress(pubkey, {
      limit,
      ...(before && isValidSolanaSignature(before) ? { before } : {}),
    }, 'confirmed')

    if (!signatures.length) return []

    const parsed = await connection.getParsedTransactions(
      signatures.map((entry) => entry.signature),
      {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      }
    )

    return parsed
      .map((tx, index) => {
        if (!tx) return null
        const meta = (tx.meta || {}) as Record<string, any>
        return {
          signature: getSignatureFromParsedTx(tx),
          transactionSignature: signatures[index]?.signature,
          blockTime: tx.blockTime ?? signatures[index]?.blockTime ?? null,
          timestamp: tx.blockTime ?? signatures[index]?.blockTime ?? null,
          slot: tx.slot,
          err: meta.err || signatures[index]?.err || null,
          fee: meta.fee || 0,
          tokenTransfers: buildTokenTransfers(meta, tx.transaction),
          transaction: tx.transaction,
          meta,
        }
      })
      .filter(Boolean)
  } catch (error) {
    console.error('Solana RPC transaction fetch error:', error)
    return []
  }
}

export async function getNftAssetsByOwner(ownerAddress: string): Promise<AlchemyNftItem[]> {
  if (SOLANA_CONFIG.ALCHEMY_API_KEY) {
    return getAlchemyAssetsByOwner(ownerAddress)
  }

  try {
    const connection = getSolanaConnection()
    const { value } = await connection.getParsedTokenAccountsByOwner(new PublicKey(ownerAddress), {
      programId: TOKEN_PROGRAM_ID,
    })

    return value
      .filter((acc) => {
        const info = acc.account?.data?.parsed?.info
        if (!info?.tokenAmount) return false
        const decimals = Number(info.tokenAmount.decimals)
        const amount = info.tokenAmount.amount ?? info.tokenAmount.uiAmount
        return decimals === 0 && (Number(amount) === 1 || amount === '1')
      })
      .map((acc) => {
        const info = acc.account?.data?.parsed?.info
        return {
          mint: info?.mint ?? '',
          name: undefined,
          symbol: undefined,
          imageUri: undefined,
        }
      })
  } catch (error) {
    console.error('Solana RPC NFT owner lookup error:', error)
    return []
  }
}

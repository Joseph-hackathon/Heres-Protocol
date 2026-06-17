'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PublicKey } from '@solana/web3.js'
import { useWallet } from '@solana/wallet-adapter-react'
import { getCapsuleByAddress } from '@/lib/solana'
import { getCachedTeeToken } from '@/lib/tee'
import { getCapsuleVaultPDA } from '@/lib/program'
import { getVaultTokenAccounts, type VaultTokenAccount } from '@/lib/spl'
import { getSolanaConnection } from '@/config/solana'
import { MAGICBLOCK_ER } from '@/constants'
import { buildIntentSignedMessage } from '@/utils/intentAuth'
import { bytesToBase64 } from '@/utils/intentClient'
import { queryKeys } from '@/lib/query/keys'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntentDeliveryStatus = {
  status: string
  updatedAt: number
  idempotencyKey: string
  lastError?: string
} | null

export type CapsuleDetailData = Awaited<ReturnType<typeof getCapsuleByAddress>>

/** Live snapshot of everything held in the capsule vault (base layer; never delegated). */
export interface VaultAssets {
  /** Raw vault lamports (includes the rent-exempt floor). */
  solLamports: number
  /** Lamports the owner can actually pull out (balance above the rent floor). */
  withdrawableSol: number
  /** Held SPL/Token-2022 assets (amount > 0), across both token programs. */
  tokens: VaultTokenAccount[]
  /** True when there is any SOL above rent or any SPL token to withdraw. */
  hasWithdrawable: boolean
}

const EMPTY_VAULT_ASSETS: VaultAssets = {
  solLamports: 0,
  withdrawableSol: 0,
  tokens: [],
  hasWithdrawable: false,
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseCapsuleDetailOptions {
  /** capsule address from the URL param */
  address: string | null
}

export type CapsuleMeta = {
  type: 'token' | 'nft'
  intent?: string
  totalAmount?: string
  assetSymbol?: string
  assetMint?: string | null
  nftMints?: string[]
  cre?: {
    enabled?: boolean
    secretRef?: string
    secretHash?: string
    recipientEmailHash?: string
    recipientEmail?: string
    deliveryChannel?: 'email' | 'sms'
  }
  premium?: {
    enabled?: boolean
    secretRef?: string
    secretHash?: string
    recipientEmailHash?: string
    recipientEmail?: string
    deliveryChannel?: 'email' | 'sms'
  }
}

export interface UseCapsuleDetail {
  capsule: CapsuleDetailData
  capsuleLoading: boolean
  capsuleError: string | null

  meta: CapsuleMeta | null
  metaLoading: boolean

  isOwner: boolean
  isIntentEnabled: boolean

  vaultSplMint: PublicKey | null
  vaultMintLoading: boolean

  /** Full multi-asset vault snapshot (SOL + every held SPL mint). */
  vaultAssets: VaultAssets
  vaultAssetsLoading: boolean

  distributionComplete: boolean
  distributionLoading: boolean

  intentDeliveryStatus: IntentDeliveryStatus
  intentDeliveryLoading: boolean
  intentDeliveryError: string | null

  /** Invalidate the capsule + distribution queries (call after mutations that change on-chain state). */
  invalidateCapsule: () => Promise<void>
  /** Invalidate the distribution query only. */
  invalidateDistribution: () => Promise<void>
  /** Invalidate the vault-assets query (call after deposit / withdraw). */
  invalidateVaultAssets: () => Promise<void>
}

export function useCapsuleDetail({
  address,
}: UseCapsuleDetailOptions): UseCapsuleDetail {
  const wallet = useWallet()
  const queryClient = useQueryClient()

  // -------------------------------------------------------------------------
  // 1. On-chain capsule (Effect 1 equivalent)
  //    Key: address only. TEE token is auth, not identity -- read at call time
  //    so the owner sees private state when a token is already cached.
  // -------------------------------------------------------------------------
  const capsuleQuery = useQuery({
    queryKey: queryKeys.capsule.byAddress(address ?? ''),
    enabled: Boolean(address),
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      if (!address) return null
      let pubkey: PublicKey
      try {
        pubkey = new PublicKey(address)
      } catch {
        throw new Error('Invalid capsule address')
      }
      // Read the cached token AT CALL TIME so an owner who minted a token
      // during creation (or via handleReveal) sees private state immediately.
      const cachedToken = wallet.publicKey ? getCachedTeeToken(wallet.publicKey) ?? undefined : undefined
      return getCapsuleByAddress(pubkey, cachedToken)
    },
  })

  const capsule = capsuleQuery.data ?? null
  const ownerPubkey = capsule?.owner

  // -------------------------------------------------------------------------
  // 2. Off-chain metadata (Effect 2 equivalent)
  // -------------------------------------------------------------------------
  const metaQuery = useQuery({
    queryKey: queryKeys.capsule.meta(address ?? ''),
    enabled: Boolean(address),
    staleTime: 5 * 60 * 1000,
    retry: 0,
    queryFn: async () => {
      if (!address) return null
      const res = await fetch(`/api/capsules/${encodeURIComponent(address)}`)
      if (!res.ok) return null
      const data = await res.json()
      const m = (data?.meta ?? data) as Record<string, any>
      return {
        type: (m?.type === 'nft' ? 'nft' : 'token') as 'token' | 'nft',
        intent: m?.intent,
        totalAmount: m?.totalAmount,
        assetSymbol: m?.assetSymbol,
        assetMint: m?.assetMint ?? null,
        nftMints: m?.nftMints,
        cre: m?.cre ?? m?.premium,
      }
    },
  })

  // -------------------------------------------------------------------------
  // Derived ownership + intent-enabled flags (computed from hook-owned data so
  // the intentDelivery enabled guard has them available on the same render).
  // -------------------------------------------------------------------------
  const meta = metaQuery.data ?? null
  const isOwner = Boolean(
    wallet.connected &&
    wallet.publicKey &&
    capsule?.owner &&
    capsule.owner.equals(wallet.publicKey)
  )
  // The queryFn always coalesces cre ?? premium into the `cre` field, so we
  // only need to check `cre` here. The CapsuleMeta type also exports `premium`
  // for the page to use (for JSX display), but for the enabled flag `cre` suffices.
  const intentConfig = meta?.cre
  const isIntentEnabled = Boolean(
    intentConfig?.enabled &&
    intentConfig.secretRef &&
    intentConfig.secretHash &&
    (intentConfig.recipientEmailHash || intentConfig.recipientEmail)
  )

  // -------------------------------------------------------------------------
  // 3. Vault assets (Effect 3 equivalent, extended to multi-asset)
  //    Enumerates SOL (above the rent floor) plus every held SPL/Token-2022 mint.
  //    Drives the balance-gated withdraw button, the per-asset withdraw list, and
  //    the add-funds flow. Enabled only when capsule.owner is known.
  // -------------------------------------------------------------------------
  const vaultAssetsQuery = useQuery<VaultAssets>({
    queryKey: queryKeys.capsule.vaultAssets(ownerPubkey?.toBase58() ?? ''),
    enabled: Boolean(ownerPubkey),
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      if (!ownerPubkey) return EMPTY_VAULT_ASSETS
      const connection = getSolanaConnection()
      const [vaultPDA] = getCapsuleVaultPDA(ownerPubkey)
      // The vault is a 9-byte CapsuleVault account; recover_vault only releases lamports above its
      // rent-exempt floor, so mirror that here to report what is actually withdrawable.
      const [vaultInfo, rentFloor, tokens] = await Promise.all([
        connection.getAccountInfo(vaultPDA),
        connection.getMinimumBalanceForRentExemption(9),
        getVaultTokenAccounts(connection, vaultPDA),
      ])
      const solLamports = vaultInfo?.lamports ?? 0
      const withdrawableSol = Math.max(0, solLamports - rentFloor)
      const heldTokens = tokens.filter((t) => t.amount > 0n)
      return {
        solLamports,
        withdrawableSol,
        tokens: heldTokens,
        hasWithdrawable: withdrawableSol > 0 || heldTokens.length > 0,
      }
    },
  })

  const vaultAssets = vaultAssetsQuery.data ?? EMPTY_VAULT_ASSETS
  // First held SPL mint - kept for the single-asset cancel path.
  const vaultSplMint = vaultAssets.tokens[0]?.mint ?? null

  // -------------------------------------------------------------------------
  // 4. Distribution complete check (Effect 4 equivalent)
  //    Guard: skip if not executed, still delegated, or owner missing.
  // -------------------------------------------------------------------------
  const isExecuted = Boolean(capsule?.executedAt)
  const isDelegated =
    capsule?.accountOwner?.equals?.(new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)) ?? false
  const distributionEnabled = Boolean(ownerPubkey) && isExecuted && !isDelegated

  const distributionQuery = useQuery({
    queryKey: queryKeys.capsule.distribution(address ?? ''),
    enabled: distributionEnabled,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      if (!ownerPubkey) return false
      const connection = getSolanaConnection()
      const [vaultPDA] = getCapsuleVaultPDA(ownerPubkey)
      const [vaultInfo, rentExemptLamports, tokenAccts] = await Promise.all([
        connection.getAccountInfo(vaultPDA),
        connection.getMinimumBalanceForRentExemption(9),
        connection
          .getParsedTokenAccountsByOwner(vaultPDA, {
            programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
          })
          .catch(() => null),
      ])
      const spendableLamports = Math.max(0, (vaultInfo?.lamports || 0) - rentExemptLamports)
      const tokensDrained =
        !tokenAccts ||
        tokenAccts.value.every(
          (t: any) => Number(t.account.data?.parsed?.info?.tokenAmount?.amount || '0') === 0
        )
      return spendableLamports === 0 && tokensDrained
    },
  })

  // -------------------------------------------------------------------------
  // 5. Intent delivery status (Effect 5 equivalent)
  //    Owner-gated + signMessage-gated. sessionStorage 4-min signature cache
  //    is preserved verbatim inside the queryFn to prevent repeat prompts.
  //    staleTime mirrors the cache TTL so we do not prompt again mid-session.
  // -------------------------------------------------------------------------
  const capsuleAddress = capsule?.capsuleAddress
  const intentDeliveryEnabled =
    Boolean(capsuleAddress) &&
    isIntentEnabled &&
    isOwner &&
    wallet.connected &&
    Boolean(wallet.publicKey) &&
    Boolean(wallet.signMessage)

  const intentDeliveryQuery = useQuery({
    queryKey: queryKeys.capsule.intentDelivery(address ?? ''),
    enabled: intentDeliveryEnabled,
    staleTime: 4 * 60 * 1000, // matches the 4-min sessionStorage TTL
    retry: 0,
    queryFn: async (): Promise<IntentDeliveryStatus> => {
      const walletPublicKey = wallet.publicKey
      const signMessage = wallet.signMessage
      if (!capsuleAddress || !walletPublicKey || !signMessage) return null

      const owner = walletPublicKey.toBase58()
      const cacheKey = `cre-status-auth:${capsuleAddress}:${owner}`
      let timestamp = 0
      let signature = ''

      try {
        const cachedRaw = sessionStorage.getItem(cacheKey)
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw) as { timestamp?: number; signature?: string }
          if (typeof cached.timestamp === 'number' && typeof cached.signature === 'string') {
            const ageMs = Date.now() - cached.timestamp
            if (ageMs >= 0 && ageMs < 4 * 60 * 1000) {
              timestamp = cached.timestamp
              signature = cached.signature
            }
          }
        }
      } catch {
        // Ignore cache parse failures and request a fresh signature.
      }

      if (!signature) {
        timestamp = Date.now()
        const message = buildIntentSignedMessage({
          action: 'delivery-status',
          owner,
          capsuleAddress,
          timestamp,
        })
        signature = bytesToBase64(await signMessage(new TextEncoder().encode(message)))
        sessionStorage.setItem(cacheKey, JSON.stringify({ timestamp, signature }))
      }

      const params = new URLSearchParams({
        capsule: capsuleAddress,
        owner,
        timestamp: String(timestamp),
      })
      const res = await fetch(`/api/intent-delivery/status?${params.toString()}`, {
        headers: { 'x-intent-signature': signature },
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to fetch Intent Statement delivery status')
      }
      const latest = Array.isArray(data.entries) ? data.entries[0] : null
      return latest ?? null
    },
  })

  // -------------------------------------------------------------------------
  // Invalidation helpers (for mutation handlers in the page)
  // -------------------------------------------------------------------------
  const invalidateCapsule = useCallback(async () => {
    if (!address) return
    await queryClient.invalidateQueries({ queryKey: queryKeys.capsule.byAddress(address) })
    if (distributionEnabled) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.capsule.distribution(address) })
    }
  }, [queryClient, address, distributionEnabled])

  const invalidateDistribution = useCallback(async () => {
    if (!address) return
    await queryClient.invalidateQueries({ queryKey: queryKeys.capsule.distribution(address) })
  }, [queryClient, address])

  const invalidateVaultAssets = useCallback(async () => {
    if (!ownerPubkey) return
    await queryClient.invalidateQueries({
      queryKey: queryKeys.capsule.vaultAssets(ownerPubkey.toBase58()),
    })
  }, [queryClient, ownerPubkey])

  // -------------------------------------------------------------------------
  // Derived error strings (mirrors original Effect 1 / Effect 5 error state)
  // -------------------------------------------------------------------------
  let capsuleError: string | null = null
  if (capsuleQuery.isError) {
    const msg = (capsuleQuery.error as Error)?.message ?? ''
    capsuleError = msg.includes('Invalid capsule address') ? 'Invalid capsule address' : 'Failed to load capsule'
  } else if (!capsuleQuery.isLoading && capsuleQuery.data === null) {
    capsuleError = 'Capsule not found'
  }

  const intentDeliveryError = intentDeliveryQuery.isError
    ? (intentDeliveryQuery.error instanceof Error
        ? intentDeliveryQuery.error.message
        : String(intentDeliveryQuery.error))
    : null

  return {
    capsule,
    capsuleLoading: capsuleQuery.isLoading,
    capsuleError,

    meta,
    metaLoading: metaQuery.isLoading,

    isOwner,
    isIntentEnabled,

    vaultSplMint,
    vaultMintLoading: vaultAssetsQuery.isLoading,

    vaultAssets,
    vaultAssetsLoading: vaultAssetsQuery.isLoading,

    distributionComplete: distributionQuery.data ?? false,
    distributionLoading: distributionQuery.isLoading,

    intentDeliveryStatus: intentDeliveryQuery.data ?? null,
    intentDeliveryLoading: intentDeliveryQuery.isLoading || intentDeliveryQuery.isFetching,
    intentDeliveryError,

    invalidateCapsule,
    invalidateDistribution,
    invalidateVaultAssets,
  }
}

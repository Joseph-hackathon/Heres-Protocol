'use client'

import { useCallback, useMemo } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { isAdminWallet } from '@/lib/admin'
import { buildAdminSignedMessage } from '@/utils/adminAuth'
import { bytesToBase64 } from '@/utils/intentClient'

// Refresh the signature comfortably inside the server's 5-min acceptance window.
const AUTH_TTL_MS = 4 * 60 * 1000

type AdminAuth = { owner: string; timestamp: number; signature: string }

export interface UseAdminAuth {
  /** Cosmetic gate: is the connected wallet on the allowlist? (No signature.) */
  isAdmin: boolean
  /**
   * Returns the admin auth headers, prompting a wallet signature once and caching
   * it in sessionStorage for the TTL so refetches do not re-prompt. Throws if the
   * wallet is missing, cannot sign, or is not allowlisted.
   */
  ensureAuthHeaders: () => Promise<Record<string, string>>
}

export function useAdminAuth(): UseAdminAuth {
  const wallet = useWallet()

  const isAdmin = useMemo(() => isAdminWallet(wallet.publicKey ?? null), [wallet.publicKey])

  const ensureAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const { publicKey, signMessage } = wallet
    if (!publicKey) throw new Error('Connect an admin wallet to continue')
    if (!signMessage) throw new Error('This wallet does not support message signing')

    const owner = publicKey.toBase58()
    if (!isAdminWallet(owner)) throw new Error('Wallet not authorized')

    const cacheKey = `admin-auth:${owner}`
    let auth: AdminAuth | null = null

    try {
      const raw = sessionStorage.getItem(cacheKey)
      if (raw) {
        const cached = JSON.parse(raw) as AdminAuth
        if (cached?.signature && typeof cached.timestamp === 'number' && Date.now() - cached.timestamp < AUTH_TTL_MS) {
          auth = cached
        }
      }
    } catch {
      // Ignore cache parse failures and sign fresh.
    }

    if (!auth) {
      const timestamp = Date.now()
      const message = buildAdminSignedMessage({ action: 'admin-dashboard', owner, timestamp })
      const signature = bytesToBase64(await signMessage(new TextEncoder().encode(message)))
      auth = { owner, timestamp, signature }
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(auth))
      } catch {
        // Non-fatal: proceed without caching.
      }
    }

    return {
      'x-admin-owner': auth.owner,
      'x-admin-timestamp': String(auth.timestamp),
      'x-admin-signature': auth.signature,
    }
  }, [wallet])

  return { isAdmin, ensureAuthHeaders }
}

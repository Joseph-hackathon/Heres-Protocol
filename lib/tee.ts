import { Connection, PublicKey } from '@solana/web3.js'
import { WalletContextState } from '@solana/wallet-adapter-react'
import { PER_TEE, MAGICBLOCK_ER } from '@/constants'
import { getAuthToken } from '@magicblock-labs/ephemeral-rollups-sdk'

/**
 * Get TEE authentication token for the current wallet
 */
export async function getTeeAuthToken(wallet: WalletContextState): Promise<string> {
    if (!wallet.publicKey || !wallet.signMessage) {
        throw new Error('Wallet not connected or does not support message signing')
    }

    try {
        const { token } = await getAuthToken(
            PER_TEE.AUTH_URL,
            wallet.publicKey,
            wallet.signMessage
        )
        return token
    } catch (error) {
        console.error('Error getting TEE auth token:', error)
        throw error
    }
}

// Session cache of minted TEE auth tokens, keyed by the minter pubkey (base58). Reading the private
// TEE copy of a delegated Switch requires a per-key token (a signMessage popup); caching it means we
// prompt once per session instead of on every read. Tokens carry their own expiry - callers re-mint
// (clear + getOrMintTeeToken) if a TEE read later fails auth.
const teeTokenCache = new Map<string, string>()

const tokenKey = (pubkey: PublicKey | string): string =>
    typeof pubkey === 'string' ? pubkey : pubkey.toBase58()

/** Cached TEE token for a pubkey, or undefined if none has been minted this session. */
export function getCachedTeeToken(pubkey: PublicKey | string): string | undefined {
    return teeTokenCache.get(tokenKey(pubkey))
}

/** Store a freshly minted TEE token so later reads can reuse it without re-prompting. */
export function setCachedTeeToken(pubkey: PublicKey | string, token: string): void {
    teeTokenCache.set(tokenKey(pubkey), token)
}

/** Drop a cached token (e.g. after it expires and a read fails auth). */
export function clearCachedTeeToken(pubkey: PublicKey | string): void {
    teeTokenCache.delete(tokenKey(pubkey))
}

/** Return the cached TEE token for the wallet, or mint one (signMessage) and cache it. */
export async function getOrMintTeeToken(wallet: WalletContextState): Promise<string> {
    if (!wallet.publicKey) throw new Error('Wallet not connected')
    const cached = teeTokenCache.get(wallet.publicKey.toBase58())
    if (cached) return cached
    const token = await getTeeAuthToken(wallet)
    teeTokenCache.set(wallet.publicKey.toBase58(), token)
    return token
}

/**
 * Get authenticated TEE connection URL
 */
export function getAuthenticatedTeeUrl(token: string): string {
    return `${PER_TEE.RPC_URL}?token=${token}`
}

/**
 * Get TEE connection
 */
export function getTeeConnection(token?: string): Connection {
    const url = token ? getAuthenticatedTeeUrl(token) : PER_TEE.RPC_URL
    return new Connection(url, 'confirmed')
}

/**
 * Verify TEE RPC integrity (placeholder for future SDK feature)
 */
export async function verifyTeeRpcIntegrity(connection: Connection): Promise<boolean> {
    // Logic to verify TEE attestation or integrity via SDK
    return true
}

/**
 * TEE Authorization Utility
 */
export const TEE_AUTH = {
    getAuthToken: getTeeAuthToken,
    getAuthenticatedUrl: getAuthenticatedTeeUrl,
    getConnection: getTeeConnection,
    verifyIntegrity: verifyTeeRpcIntegrity,
}

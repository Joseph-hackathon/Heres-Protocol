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

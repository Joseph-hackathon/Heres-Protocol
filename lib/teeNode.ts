import { PublicKey } from '@solana/web3.js'
import { PER_TEE } from '@/constants'
import { getAuthToken as sdkGetAuthToken } from '@magicblock-labs/ephemeral-rollups-sdk'

export async function getTeeAuthTokenForPubkey(
  pubkey: PublicKey,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<string> {
  try {
    const { token } = await sdkGetAuthToken(PER_TEE.AUTH_URL, pubkey, signMessage)
    return token
  } catch (error: any) {
    throw new Error(`Failed to get TEE auth token: ${error.message}`)
  }
}

export async function getTeeAuthTokenForKeypair(
  keypair: { publicKey: PublicKey; signMessage: (msg: Uint8Array) => Promise<Uint8Array> }
): Promise<string> {
  return getTeeAuthTokenForPubkey(keypair.publicKey, keypair.signMessage)
}

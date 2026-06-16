import { createPublicKey, verify } from 'crypto'
import { PublicKey } from '@solana/web3.js'
import { buildAdminSignedMessage } from '@/utils/adminAuth'
import { isAdminWallet } from '@/lib/admin'

/**
 * Server-side admin authorization. The admin explorer sends three headers:
 *   x-admin-owner      base58 wallet pubkey
 *   x-admin-timestamp  ms epoch the message was signed at
 *   x-admin-signature  base64 ed25519 signature of buildAdminSignedMessage(...)
 *
 * A request is authorized only if the wallet is allowlisted, the timestamp is
 * recent, and the signature verifies against the wallet's public key. This is the
 * actual gate -- the client-side allowlist check is only cosmetic.
 */
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export type AdminAuthResult = { ok: true; owner: string } | { ok: false; status: number; error: string }

function verifySignature(owner: string, message: string, signatureBase64: string): boolean {
  try {
    const pubkey = new PublicKey(owner)
    const der = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubkey.toBytes())])
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' })
    const signature = Buffer.from(signatureBase64, 'base64')
    if (signature.length === 0) return false
    return verify(null, Buffer.from(message, 'utf8'), key, signature)
  } catch {
    return false
  }
}

export function verifyAdminRequest(headers: Headers): AdminAuthResult {
  const owner = headers.get('x-admin-owner')?.trim() || ''
  const timestampRaw = headers.get('x-admin-timestamp') || ''
  const signature = headers.get('x-admin-signature') || ''

  if (!owner || !timestampRaw || !signature) {
    return { ok: false, status: 401, error: 'Missing admin authorization' }
  }
  if (!isAdminWallet(owner)) {
    return { ok: false, status: 403, error: 'Wallet not authorized' }
  }

  const timestamp = Number(timestampRaw)
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > SIGNATURE_MAX_AGE_MS) {
    return { ok: false, status: 401, error: 'Authorization expired, please re-sign' }
  }

  const message = buildAdminSignedMessage({ action: 'admin-dashboard', owner, timestamp })
  if (!verifySignature(owner, message, signature)) {
    return { ok: false, status: 401, error: 'Invalid admin signature' }
  }

  return { ok: true, owner }
}

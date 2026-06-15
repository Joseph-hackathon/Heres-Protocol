import { createHash, createPublicKey, timingSafeEqual, verify } from 'crypto'
import { PublicKey } from '@solana/web3.js'
import { buildIntentSignedMessage } from '../../utils/intentAuth.ts'
import type { IntentSignedAction } from '../../utils/intentAuth.ts'

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

type VerifyIntentRequestInput = {
  action: IntentSignedAction
  owner: string
  timestamp: number
  signatureBase64: string
  capsuleAddress?: string
  recipientEmailHash?: string
  messageHash?: string
}

function verifySolanaMessageSignature(owner: string, message: string, signatureBase64: string): boolean {
  try {
    const pubkey = new PublicKey(owner)
    const publicKeyDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubkey.toBytes())])
    const key = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' })
    const signature = Buffer.from(signatureBase64, 'base64')
    if (signature.length === 0) return false
    return verify(null, Buffer.from(message, 'utf8'), key, signature)
  } catch {
    return false
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false
  const aBuf = Buffer.from(a, 'hex')
  const bBuf = Buffer.from(b, 'hex')
  if (aBuf.length === 0 || bBuf.length === 0 || aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

export function isRecentTimestamp(timestamp: number): boolean {
  if (!Number.isFinite(timestamp)) return false
  const now = Date.now()
  return Math.abs(now - timestamp) <= SIGNATURE_MAX_AGE_MS
}

export function verifyIntentSignedRequest(input: VerifyIntentRequestInput): boolean {
  if (!isRecentTimestamp(input.timestamp)) return false
  const message = buildIntentSignedMessage({
    action: input.action,
    owner: input.owner,
    timestamp: input.timestamp,
    capsuleAddress: input.capsuleAddress,
    recipientEmailHash: input.recipientEmailHash,
    messageHash: input.messageHash,
  })
  return verifySolanaMessageSignature(input.owner, message, input.signatureBase64)
}

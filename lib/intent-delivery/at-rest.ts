/**
 * Server-side at-rest encryption for intent-delivery statements.
 *
 * Replaces the previous client-side, access-code-derived encryption. In a
 * dead-man's-switch the owner is gone at delivery time, so an owner-chosen
 * unlock code is guaranteed-undecryptable - a guaranteed failed delivery. The
 * genuinely-private data (the beneficiary split) is already TEE-protected
 * on-chain; the intent statement is a message to a human recipient. So the
 * server encrypts it at rest with a server-held key (INTENT_AT_REST_KEY) and
 * decrypts it only at dispatch, just before emailing the recipient in plaintext.
 *
 * AES-256-GCM. Key is 32 bytes, supplied as base64 (recommended) or 64-char hex.
 * Generate one with:  openssl rand -base64 32
 *
 * Dependency-free (node:crypto only, no path aliases, no 'server-only') so it is
 * unit-testable in isolation via node --test --experimental-strip-types.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const VERSION = 'v1'
const IV_BYTES = 12
const KEY_BYTES = 32

function isProductionRuntime(): boolean {
  return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'
}

function decodeKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim()
  // 64 hex chars => 32 bytes.
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex')
  // Otherwise treat as base64 (standard or url-safe).
  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64')
}

let cachedKey: Buffer | null = null

function loadKey(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.INTENT_AT_REST_KEY?.trim()
  if (raw) {
    const key = decodeKeyMaterial(raw)
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `INTENT_AT_REST_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate one with: openssl rand -base64 32`
      )
    }
    cachedKey = key
    return key
  }
  if (isProductionRuntime()) {
    throw new Error('INTENT_AT_REST_KEY is required in production to encrypt intent statements at rest')
  }
  // Dev-only deterministic fallback so local dev + build-check work without a
  // configured key. NEVER reached in production (guarded above).
  console.warn(
    '[intent/at-rest] INTENT_AT_REST_KEY not set - using an INSECURE deterministic dev key. Set INTENT_AT_REST_KEY before deploying.'
  )
  cachedKey = createHash('sha256').update('heres-dev-insecure-at-rest-key-v1').digest()
  return cachedKey
}

/** Encrypt plaintext to a compact, self-describing string: v1.<iv>.<tag>.<ct> (all base64). */
export function encryptAtRest(plaintext: string): string {
  const key = loadKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.')
}

/** Decrypt a payload produced by encryptAtRest. Throws on tamper or wrong key. */
export function decryptAtRest(payload: string): string {
  const parts = payload.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed at-rest payload')
  }
  const key = loadKey()
  const iv = Buffer.from(parts[1], 'base64')
  const tag = Buffer.from(parts[2], 'base64')
  const ciphertext = Buffer.from(parts[3], 'base64')
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/** True when an explicit at-rest key is configured (for fail-closed pre-checks). */
export function isAtRestKeyConfigured(): boolean {
  return Boolean(process.env.INTENT_AT_REST_KEY?.trim())
}

/**
 * Browser-side helpers for intent-delivery registration.
 *
 * Client-side encryption (encryptPrivateMessage) was removed: the intent
 * statement is now sent as plaintext over TLS, bound by the owner's wallet
 * signature, and encrypted at rest on the server (see lib/intent-delivery/at-rest.ts). An
 * owner-chosen access code could not work for a dead-man's-switch - the owner is
 * gone at delivery, so the code would be unrecoverable. Only the signing helpers
 * remain.
 */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export async function sha256Hex(value: string): Promise<string> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Web Crypto API is unavailable in this environment')
  }
  const input = new TextEncoder().encode(value) as BufferSource
  const digest = await window.crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

import test from 'node:test'
import assert from 'node:assert/strict'

// Use a fixed 32-byte key so the round-trip is deterministic and does not rely
// on the dev fallback. Must be set before the first encrypt/decrypt call.
process.env.INTENT_AT_REST_KEY = Buffer.alloc(32, 7).toString('base64')

const { encryptAtRest, decryptAtRest } = await import('../lib/intent-delivery/at-rest.ts')

test('at-rest encrypt/decrypt round-trips', () => {
  const msg = 'To my family: the cold-wallet seed is in the blue notebook. - A'
  const ciphertext = encryptAtRest(msg)
  assert.notEqual(ciphertext, msg)
  assert.match(ciphertext, /^v1\./)
  assert.equal(decryptAtRest(ciphertext), msg)
})

test('at-rest ciphertext is non-deterministic (random IV per call)', () => {
  const a = encryptAtRest('same plaintext')
  const b = encryptAtRest('same plaintext')
  assert.notEqual(a, b)
  assert.equal(decryptAtRest(a), 'same plaintext')
  assert.equal(decryptAtRest(b), 'same plaintext')
})

test('at-rest rejects a tampered ciphertext (GCM auth tag)', () => {
  const parts = encryptAtRest('secret').split('.')
  const ct = Buffer.from(parts[3], 'base64')
  ct[0] ^= 0xff
  parts[3] = ct.toString('base64')
  assert.throws(() => decryptAtRest(parts.join('.')))
})

test('at-rest rejects malformed payloads', () => {
  assert.throws(() => decryptAtRest('not-a-valid-payload'))
  assert.throws(() => decryptAtRest('v2.a.b.c'))
})

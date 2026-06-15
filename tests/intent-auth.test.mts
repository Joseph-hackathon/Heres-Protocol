import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import bs58 from 'bs58'
import { buildIntentSignedMessage } from '../utils/intentAuth.ts'
import { safeEqualHex, sha256Hex, verifyIntentSignedRequest } from '../lib/intent-delivery/auth.ts'

test('buildIntentSignedMessage is deterministic and scoped by action', () => {
  const a = buildIntentSignedMessage({
    action: 'register-secret',
    owner: 'owner1',
    timestamp: 123,
    recipientEmailHash: 'aa',
    messageHash: 'bb',
  })
  const b = buildIntentSignedMessage({
    action: 'delivery-status',
    owner: 'owner1',
    timestamp: 123,
    capsuleAddress: 'capsule1',
  })

  assert.match(a, /action:register-secret/)
  assert.match(a, /recipientEmailHash:aa/)
  assert.match(b, /action:delivery-status/)
  assert.match(b, /capsule:capsule1/)
  assert.notEqual(a, b)
})

test('safeEqualHex and sha256Hex integrity helpers', () => {
  assert.equal(sha256Hex('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  assert.equal(safeEqualHex('aa', 'aa'), true)
  assert.equal(safeEqualHex('aa', 'ab'), false)
  assert.equal(safeEqualHex('zz', 'zz'), false)
})

test('verifyIntentSignedRequest accepts valid signatures and rejects tampered payloads', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  const owner = bs58.encode(spki.subarray(spki.length - 32))

  const timestamp = Date.now()
  const message = buildIntentSignedMessage({
    action: 'register-secret',
    owner,
    timestamp,
    recipientEmailHash: sha256Hex('alice@example.com'),
    messageHash: sha256Hex('{"ciphertext":"x"}'),
  })
  const signature = sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64')

  const valid = verifyIntentSignedRequest({
    action: 'register-secret',
    owner,
    timestamp,
    signatureBase64: signature,
    recipientEmailHash: sha256Hex('alice@example.com'),
    messageHash: sha256Hex('{"ciphertext":"x"}'),
  })
  assert.equal(valid, true)

  const tampered = verifyIntentSignedRequest({
    action: 'register-secret',
    owner,
    timestamp,
    signatureBase64: signature,
    recipientEmailHash: sha256Hex('mallory@example.com'),
    messageHash: sha256Hex('{"ciphertext":"x"}'),
  })
  assert.equal(tampered, false)

  const expired = verifyIntentSignedRequest({
    action: 'register-secret',
    owner,
    timestamp: timestamp - 10 * 60 * 1000,
    signatureBase64: signature,
    recipientEmailHash: sha256Hex('alice@example.com'),
    messageHash: sha256Hex('{"ciphertext":"x"}'),
  })
  assert.equal(expired, false)
})

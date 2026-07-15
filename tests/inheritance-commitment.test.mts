import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PublicKey } from '@solana/web3.js'
import {
  createInheritanceCommitment,
  encodeInheritanceCommitment,
} from '../lib/inheritance-commitment.ts'

test('inheritance commitment matches the on-chain test vector', async () => {
  const owner = new PublicKey('11111111111111111111111111111111')
  const beneficiaries = [{
    pubkey: new PublicKey('SysvarC1ock11111111111111111111111111111111'),
    shareBps: 10_000,
  }]
  const nftAssignments = [{
    mint: new PublicKey('So11111111111111111111111111111111111111112'),
    recipient: new PublicKey('SysvarRent111111111111111111111111111111111'),
  }]
  const salt = new Uint8Array(32).fill(7)
  const encoded = encodeInheritanceCommitment(owner, beneficiaries, nftAssignments, salt)
  const commitment = await createInheritanceCommitment(owner, beneficiaries, nftAssignments, salt)

  assert.equal(encoded.length, 197)
  assert.equal(
    Buffer.from(commitment).toString('hex'),
    'ca62c744544ee2818fa88e94cac68716290a5c9491c3f03b957075974e8ce624'
  )
})

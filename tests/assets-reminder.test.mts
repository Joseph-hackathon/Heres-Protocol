import test from 'node:test'
import assert from 'node:assert/strict'
import { PublicKey } from '@solana/web3.js'
import { getAssetConfig, inferAssetConfig, isAssetConfigured, toAtomicAmount } from '../lib/assets.ts'
import { computeNextReminderAt, createReminderIdempotencyKey } from '../lib/cre/reminder-schedule.ts'

test('asset registry exposes supported BTC and ETH symbols even when mints are env-driven', () => {
  const btc = getAssetConfig('BTC')
  const eth = getAssetConfig('ETH')

  assert.equal(btc.symbol, 'BTC')
  assert.equal(eth.symbol, 'ETH')
  assert.equal(isAssetConfigured('SOL'), true)
  assert.equal(typeof btc.mint === 'string' || btc.mint === null, true)
  assert.equal(typeof eth.mint === 'string' || eth.mint === null, true)
})

test('inferAssetConfig prefers explicit payload symbol over mint fallback', () => {
  const explicitEthMint = 'ETHExplicitMint11111111111111111111111111111'
  const eth = inferAssetConfig(
    { assetSymbol: 'ETH', assetMint: explicitEthMint },
    new PublicKey('11111111111111111111111111111111')
  )

  assert.equal(eth.symbol, 'ETH')
  assert.equal(eth.mint, explicitEthMint)
})

test('reminder helpers default to a 30-day cadence and deterministic idempotency key', () => {
  const base = Date.UTC(2026, 3, 11, 0, 0, 0)
  const next = computeNextReminderAt(base)

  assert.equal(next - base, 30 * 24 * 60 * 60 * 1000)
  assert.equal(
    createReminderIdempotencyKey('capsule123', next),
    `capsule123:${next}`
  )
})

test('toAtomicAmount respects asset decimals for SOL and BTC', () => {
  assert.equal(toAtomicAmount('1.25', { assetSymbol: 'SOL' }), 1_250_000_000n)
  assert.equal(toAtomicAmount('0.12345678', { assetSymbol: 'BTC' }), 12_345_678n)
})

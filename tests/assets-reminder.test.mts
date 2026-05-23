import test from 'node:test'
import assert from 'node:assert/strict'
import { PublicKey } from '@solana/web3.js'
import {
  getAssetConfig,
  getAssetMintPublicKey,
  getAssetNetworkLabels,
  inferAssetConfig,
  isAssetConfigured,
  isSolanaAssetConfigured,
  isStellarIssuerConfigured,
  SUPPORTED_TOKEN_ASSET_SYMBOLS,
  toAtomicAmount,
} from '../lib/assets.ts'
import { computeNextReminderAt, createReminderIdempotencyKey } from '../lib/cre/reminder-schedule.ts'

test('asset registry exposes the product asset matrix', () => {
  const btc = getAssetConfig('BTC')
  const eth = getAssetConfig('ETH')
  const audd = getAssetConfig('AUDD')
  const xlm = getAssetConfig('XLM')

  assert.deepEqual(SUPPORTED_TOKEN_ASSET_SYMBOLS, ['BTC', 'ETH', 'SOL', 'AUDD', 'XLM'])
  assert.equal(btc.symbol, 'BTC')
  assert.equal(eth.symbol, 'ETH')
  assert.equal(audd.symbol, 'AUDD')
  assert.equal(xlm.symbol, 'XLM')
  assert.deepEqual(btc.networks, ['solana', 'stellar'])
  assert.deepEqual(eth.networks, ['solana', 'stellar'])
  assert.deepEqual(getAssetConfig('SOL').networks, ['solana'])
  assert.deepEqual(audd.networks, ['solana', 'stellar'])
  assert.deepEqual(xlm.networks, ['stellar'])
  assert.equal(getAssetNetworkLabels('AUDD'), 'Solana / Stellar')
  assert.equal(isAssetConfigured('SOL'), true)
  assert.equal(isAssetConfigured('XLM'), true)
  assert.equal(isSolanaAssetConfigured('XLM'), false)
  assert.equal(isStellarIssuerConfigured('XLM'), true)
  assert.equal(typeof btc.mint === 'string' || btc.mint === null, true)
  assert.equal(typeof eth.mint === 'string' || eth.mint === null, true)
  assert.equal(typeof audd.mint === 'string' || audd.mint === null, true)
})

test('BTC and ETH configuration flags follow whether a mint is present', () => {
  const btc = getAssetConfig('BTC')
  const eth = getAssetConfig('ETH')

  assert.equal(isSolanaAssetConfigured('BTC'), Boolean(btc.mint))
  assert.equal(isSolanaAssetConfigured('ETH'), Boolean(eth.mint))
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

test('toAtomicAmount respects asset decimals for SOL, BTC, mSOL, AUDD, and XLM', () => {
  assert.equal(toAtomicAmount('1.25', { assetSymbol: 'SOL' }), 1_250_000_000n)
  assert.equal(toAtomicAmount('0.12345678', { assetSymbol: 'BTC' }), 12_345_678n)
  assert.equal(toAtomicAmount('0.12345678', { assetSymbol: 'ETH' }), 12_345_678n)
  assert.equal(toAtomicAmount('1.25', { assetSymbol: 'MSOL' }), 1_250_000_000n)
  assert.equal(toAtomicAmount('1.250001', { assetSymbol: 'AUDD' }), 1_250_001n)
  assert.equal(toAtomicAmount('1.1234567', { assetSymbol: 'XLM' }), 11_234_567n)
})

test('BTC and ETH mint helpers return undefined when the asset is not configured', () => {
  const btc = getAssetConfig('BTC')
  const eth = getAssetConfig('ETH')

  if (btc.mint) {
    assert.equal(getAssetMintPublicKey('BTC')?.toBase58(), btc.mint)
  } else {
    assert.equal(getAssetMintPublicKey('BTC'), undefined)
  }

  if (eth.mint) {
    assert.equal(getAssetMintPublicKey('ETH')?.toBase58(), eth.mint)
  } else {
    assert.equal(getAssetMintPublicKey('ETH'), undefined)
  }
})

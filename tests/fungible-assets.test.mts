import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPSULE_CREATION_SOL_RESERVE_LAMPORTS,
  formatBaseUnits,
  parseDecimalToBaseUnits,
  planMultiMintCancellation,
  spendableSolLamports,
} from '../lib/fungible-assets.ts'

test('decimal amounts convert to base units without floating-point loss', () => {
  assert.equal(parseDecimalToBaseUnits('1.000000001', 9), 1_000_000_001n)
  assert.equal(parseDecimalToBaseUnits('9007199254740993.123456', 6), 9_007_199_254_740_993_123_456n)
  assert.equal(parseDecimalToBaseUnits('0.000001', 6), 1n)
})

test('SOL creation balance keeps the fee and rent reserve out of the deposit maximum', () => {
  assert.equal(spendableSolLamports(null), null)
  assert.equal(spendableSolLamports(50_000_000), 0n)
  assert.equal(
    spendableSolLamports(1_000_000_000),
    1_000_000_000n - CAPSULE_CREATION_SOL_RESERVE_LAMPORTS
  )
})

test('decimal amount parsing rejects unsafe formats and excess precision', () => {
  assert.equal(parseDecimalToBaseUnits('', 9), null)
  assert.equal(parseDecimalToBaseUnits('0', 9), null)
  assert.equal(parseDecimalToBaseUnits('-1', 9), null)
  assert.equal(parseDecimalToBaseUnits('1e3', 9), null)
  assert.equal(parseDecimalToBaseUnits('1.0000001', 6), null)
  assert.equal(parseDecimalToBaseUnits('1.1', 0), null)
  assert.equal(parseDecimalToBaseUnits('1', -1), null)
  assert.equal(parseDecimalToBaseUnits('1', 1.5), null)
})

test('decimal amount parsing handles whitespace, leading zeroes, and zero-decimal assets', () => {
  assert.equal(parseDecimalToBaseUnits(' 001.20 ', 2), 120n)
  assert.equal(parseDecimalToBaseUnits('42', 0), 42n)
})

test('base-unit formatting preserves large balances', () => {
  assert.equal(formatBaseUnits(9_007_199_254_740_993_123_456n, 6), '9007199254740993.123456')
  assert.equal(formatBaseUnits(1_230_000_000n, 9), '1.23')
  assert.equal(formatBaseUnits(1n, 18), '0.000000000000000001')
})

test('base-unit formatting handles signs, zero decimals, and fraction caps', () => {
  assert.equal(formatBaseUnits(-1_234n, 2), '-12.34')
  assert.equal(formatBaseUnits(42n, 0), '42')
  assert.equal(formatBaseUnits(1_239_999n, 6, 2), '1.23')
  assert.equal(formatBaseUnits(1_000_000n, 6, 0), '1')
})

test('multi-mint cancellation recovers every extra mint before the final cancel leg', () => {
  assert.deepEqual(planMultiMintCancellation<string>([]), { recoverFirst: [], cancelWith: null })
  assert.deepEqual(planMultiMintCancellation(['mint-a']), { recoverFirst: [], cancelWith: 'mint-a' })
  assert.deepEqual(planMultiMintCancellation(['mint-a', 'mint-b', 'mint-c']), {
    recoverFirst: ['mint-a', 'mint-b'],
    cancelWith: 'mint-c',
  })
})

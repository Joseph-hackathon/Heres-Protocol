import test from 'node:test'
import assert from 'node:assert/strict'
import { formatTransferAmount, parseTransferAmount } from '../lib/transfer-amount.ts'

test('transfer amounts convert exactly without floating-point rounding', () => {
  assert.equal(parseTransferAmount('0.000000001', 9), 1n)
  assert.equal(parseTransferAmount('12.3456', 6), 12_345_600n)
  assert.equal(parseTransferAmount('18446744073.709551615', 9), 18_446_744_073_709_551_615n)
})

test('transfer amounts reject unsafe or unsupported input', () => {
  assert.equal(parseTransferAmount('', 9), null)
  assert.equal(parseTransferAmount('0', 9), null)
  assert.equal(parseTransferAmount('-1', 9), null)
  assert.equal(parseTransferAmount('1e3', 9), null)
  assert.equal(parseTransferAmount('1.0000000001', 9), null)
})

test('base units format as an exact editable decimal', () => {
  assert.equal(formatTransferAmount(1n, 9), '0.000000001')
  assert.equal(formatTransferAmount(12_345_600n, 6), '12.3456')
  assert.equal(formatTransferAmount(42n, 0), '42')
})

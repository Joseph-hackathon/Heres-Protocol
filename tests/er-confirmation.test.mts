import assert from 'node:assert/strict'
import test from 'node:test'
import { isDurableErConfirmation } from '../lib/er-confirmation.ts'

test('only finalized ER transactions are durable enough for cross-ER advancement', () => {
  assert.equal(isDurableErConfirmation('finalized'), true)
  assert.equal(isDurableErConfirmation('confirmed'), false)
  assert.equal(isDurableErConfirmation('processed'), false)
  assert.equal(isDurableErConfirmation(null), false)
  assert.equal(isDurableErConfirmation(undefined), false)
})

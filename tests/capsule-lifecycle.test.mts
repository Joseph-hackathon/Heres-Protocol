import test from 'node:test'
import assert from 'node:assert/strict'
import {
  areCapsuleAccountsOnBase,
  capsuleSettlementGuidance,
  classifyCapsuleAccountOwner,
  hasDelegatedCapsuleAccounts,
  hasExistingCapsuleAccounts,
} from '../lib/capsule-lifecycle.ts'
import { normalizeTxError } from '../lib/errors.ts'

const programId = 'HeresProgram'
const delegationProgramId = 'MagicDelegation'

test('account ownership classification distinguishes all lifecycle locations', () => {
  assert.equal(classifyCapsuleAccountOwner(programId, programId, delegationProgramId), 'base')
  assert.equal(
    classifyCapsuleAccountOwner(delegationProgramId, programId, delegationProgramId),
    'delegated'
  )
  assert.equal(classifyCapsuleAccountOwner(null, programId, delegationProgramId), 'missing')
  assert.equal(classifyCapsuleAccountOwner('AnotherProgram', programId, delegationProgramId), 'unexpected')
})

test('partial undelegation remains delegated and blocks base-layer actions', () => {
  const locations = {
    switch: 'base' as const,
    beneficiarySet: 'delegated' as const,
    switchAddress: 'switch',
    beneficiarySetAddress: 'beneficiaries',
  }

  assert.equal(hasExistingCapsuleAccounts(locations), true)
  assert.equal(hasDelegatedCapsuleAccounts(locations), true)
  assert.equal(areCapsuleAccountsOnBase(locations), false)
  assert.match(capsuleSettlementGuidance(locations), /Finish Undelegation/)
})

test('base-layer actions unlock only after both accounts settle', () => {
  const locations = {
    switch: 'base' as const,
    beneficiarySet: 'base' as const,
    switchAddress: 'switch',
    beneficiarySetAddress: 'beneficiaries',
  }

  assert.equal(hasDelegatedCapsuleAccounts(locations), false)
  assert.equal(areCapsuleAccountsOnBase(locations), true)
})

test('missing, partial, and unexpected lifecycle states remain closed', () => {
  const states = [
    ['missing', 'missing'],
    ['base', 'missing'],
    ['missing', 'base'],
    ['unexpected', 'base'],
    ['base', 'unexpected'],
  ] as const

  for (const [switchState, beneficiaryState] of states) {
    const locations = {
      switch: switchState,
      beneficiarySet: beneficiaryState,
      switchAddress: 'switch',
      beneficiarySetAddress: 'beneficiaries',
    }
    assert.equal(areCapsuleAccountsOnBase(locations), false)
  }
})

test('settlement guidance covers every account-location outcome', () => {
  const location = (switchState: 'base' | 'delegated' | 'missing' | 'unexpected', beneficiaryState: 'base' | 'delegated' | 'missing' | 'unexpected') => ({
    switch: switchState,
    beneficiarySet: beneficiaryState,
    switchAddress: 'switch',
    beneficiarySetAddress: 'beneficiaries',
  })

  assert.match(capsuleSettlementGuidance(location('base', 'base')), /settled on Solana/)
  assert.match(capsuleSettlementGuidance(location('delegated', 'delegated')), /Undelegate/)
  assert.match(capsuleSettlementGuidance(location('base', 'delegated')), /Finish Undelegation/)
  assert.match(capsuleSettlementGuidance(location('missing', 'missing')), /could not verify/)
  assert.match(capsuleSettlementGuidance(location('unexpected', 'base')), /could not verify/)
})

test('wrong-program beneficiary errors direct users to finish undelegation', () => {
  const message = normalizeTxError(
    'AnchorError caused by account: beneficiary_set. Error Code: AccountOwnedByWrongProgram. Error Number: 3007.'
  )

  assert.match(message, /Finish Undelegation/)
  assert.doesNotMatch(message, /AnchorError|3007/)
})

test('unknown Anchor failures do not expose transaction logs', () => {
  const message = normalizeTxError(
    'Transaction abc failed: Program log: AnchorError caused by account: capsule'
  )

  assert.match(message, /Refresh My Capsule/)
  assert.doesNotMatch(message, /Transaction abc|Program log|AnchorError/)
})

test('known capsule failures map to actionable messages', () => {
  const cases = [
    ['CapsuleActive', /Manage or cancel/],
    ['CapsuleInactive', /Refresh My Capsule/],
    ['CapsuleNotExecuted', /Execute the capsule first/],
    ['InactivityPeriodNotMet', /trigger has not been reached/],
    ['NoBeneficiaries', /No beneficiaries/],
    ['NothingToDistribute', /vault is already empty/],
    ['Unauthorized', /not authorized/],
  ] as const

  for (const [raw, expected] of cases) {
    assert.match(normalizeTxError(raw), expected)
  }
})

test('wallet, balance, expiry, simulation, and network errors are normalized', () => {
  assert.match(normalizeTxError('User rejected the request'), /rejected/)
  assert.match(normalizeTxError('insufficient funds'), /Insufficient balance/)
  assert.match(normalizeTxError('block height exceeded'), /expired/)
  assert.equal(
    normalizeTxError('Transaction simulation failed: custom program error: 0x1770'),
    'The program rejected this transaction (error 6000).'
  )
  assert.match(normalizeTxError('429 network error'), /Network error/)
  assert.match(normalizeTxError('Wallet not connected'), /Connect your wallet/)
})

test('unknown errors preserve useful messages and empty errors use a safe fallback', () => {
  assert.equal(normalizeTxError(new Error('Readable failure')), 'Readable failure')
  assert.equal(normalizeTxError(null), 'Something went wrong. Please try again.')
})

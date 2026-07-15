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

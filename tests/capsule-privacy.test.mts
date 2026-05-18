import test from 'node:test'
import assert from 'node:assert/strict'
import { getCapsuleDetailAccess } from '../lib/capsule-privacy.ts'
import { buildSimplePdf } from '../utils/pdf.ts'

test('capsule detail access allows only the owner before beneficiary release', () => {
  const access = getCapsuleDetailAccess({
    ownerAddress: 'owner111',
    viewerAddress: 'owner111',
    executedAtSeconds: null,
    intent: {
      type: 'token',
      delayDays: 30,
      beneficiaries: [{ chain: 'solana', address: 'beneficiary111' }],
    },
  })

  const blocked = getCapsuleDetailAccess({
    ownerAddress: 'owner111',
    viewerAddress: 'beneficiary111',
    executedAtSeconds: null,
    intent: {
      type: 'token',
      delayDays: 30,
      beneficiaries: [{ chain: 'solana', address: 'beneficiary111' }],
    },
  })

  assert.equal(access.role, 'owner')
  assert.equal(blocked.role, 'none')
})

test('beneficiary-only window activates after execution plus delay', () => {
  const nowMs = Date.UTC(2026, 0, 31, 0, 0, 0)
  const executedAtSeconds = Date.UTC(2026, 0, 1, 0, 0, 0) / 1000

  const beneficiary = getCapsuleDetailAccess({
    ownerAddress: 'owner111',
    viewerAddress: 'beneficiary111',
    executedAtSeconds,
    nowMs,
    intent: {
      type: 'token',
      delayDays: 30,
      beneficiaries: [{ chain: 'solana', address: 'beneficiary111' }],
    },
  })

  const owner = getCapsuleDetailAccess({
    ownerAddress: 'owner111',
    viewerAddress: 'owner111',
    executedAtSeconds,
    nowMs,
    intent: {
      type: 'token',
      delayDays: 30,
      beneficiaries: [{ chain: 'solana', address: 'beneficiary111' }],
    },
  })

  assert.equal(beneficiary.role, 'beneficiary')
  assert.equal(owner.role, 'none')
})

test('simple PDF builder returns a valid PDF header', () => {
  const pdf = buildSimplePdf('Title', ['Line 1', 'Line 2'])
  const prefix = new TextDecoder().decode(pdf.slice(0, 8))

  assert.equal(prefix, '%PDF-1.4')
})

/**
 * Validation utilities
 */

import { Beneficiary } from '@/types'
import { isValidSolanaAddress } from '@/config/solana'
import { CreIntentData } from '@/utils/intent'

/**
 * Validate beneficiary addresses
 */
export function validateBeneficiaryAddresses(beneficiaries: Beneficiary[]): boolean {
  return beneficiaries.every(b => 
    b.address && isValidSolanaAddress(b.address)
  )
}

export function isValidBeneficiaryAddress(beneficiary: Beneficiary): boolean {
  return Boolean(beneficiary.address && isValidSolanaAddress(beneficiary.address))
}

/**
 * Validate beneficiary amounts
 */
export function validateBeneficiaryAmounts(beneficiaries: Beneficiary[]): boolean {
  return beneficiaries.every(b => {
    const amount = parseFloat(b.amount || '0')
    return amount > 0
  })
}

/**
 * Validate percentage totals
 */
export function validatePercentageTotals(beneficiaries: Beneficiary[]): boolean {
  const percentageBeneficiaries = beneficiaries.filter(b => b.amountType === 'percentage')
  if (percentageBeneficiaries.length === 0) return true

  const totalPercentage = percentageBeneficiaries.reduce(
    (sum, b) => sum + parseFloat(b.amount || '0'),
    0
  )
  
  return Math.abs(totalPercentage - 100) < 0.01
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function validateCreIntent(cre: CreIntentData | undefined): boolean {
  if (!cre) return true
  if (!cre.enabled) return true
  if (!cre.secretRef || !cre.secretHash) return false
  if (!cre.recipientEmailHash) return false
  return /^[a-f0-9]{64}$/.test(cre.recipientEmailHash)
}

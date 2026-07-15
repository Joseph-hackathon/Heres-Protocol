export type CapsuleAccountLocation = 'base' | 'delegated' | 'missing' | 'unexpected'

export interface CapsuleAccountLocations {
  switch: CapsuleAccountLocation
  beneficiarySet: CapsuleAccountLocation
  switchAddress: string
  beneficiarySetAddress: string
}

export function classifyCapsuleAccountOwner(
  owner: string | null,
  programId: string,
  delegationProgramId: string
): CapsuleAccountLocation {
  if (!owner) return 'missing'
  if (owner === programId) return 'base'
  if (owner === delegationProgramId) return 'delegated'
  return 'unexpected'
}

export function hasExistingCapsuleAccounts(locations: CapsuleAccountLocations): boolean {
  return locations.switch !== 'missing' || locations.beneficiarySet !== 'missing'
}

export function hasDelegatedCapsuleAccounts(locations: CapsuleAccountLocations | null): boolean {
  return Boolean(
    locations &&
      (locations.switch === 'delegated' || locations.beneficiarySet === 'delegated')
  )
}

export function areCapsuleAccountsOnBase(locations: CapsuleAccountLocations | null): boolean {
  return Boolean(
    locations && locations.switch === 'base' && locations.beneficiarySet === 'base'
  )
}

export function capsuleSettlementGuidance(
  locations: CapsuleAccountLocations | null
): string {
  if (!locations) return 'Checking where your capsule data is stored...'

  if (locations.switch === 'delegated' && locations.beneficiarySet === 'delegated') {
    return 'Your capsule is still secured in the private rollup. Select Undelegate from ER before using base-layer actions.'
  }

  if (locations.switch === 'base' && locations.beneficiarySet === 'delegated') {
    return 'The capsule switch is settled, but the private beneficiary data is still in the TEE. Select Finish Undelegation before distributing or cancelling.'
  }

  if (locations.switch === 'delegated' && locations.beneficiarySet === 'base') {
    return 'The beneficiary data is settled, but the capsule switch is still in the rollup. Select Finish Undelegation before using base-layer actions.'
  }

  if (areCapsuleAccountsOnBase(locations)) {
    return 'The capsule and beneficiary data are settled on Solana.'
  }

  return 'Heres could not verify the complete capsule account state. Refresh the page before taking another action.'
}

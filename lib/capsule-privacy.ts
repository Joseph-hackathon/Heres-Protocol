type TokenIntentLike = {
  type?: 'token'
  beneficiaries?: Array<{ chain?: string; address?: string }>
  delayDays?: number
}

type NftIntentLike = {
  type?: 'nft'
  nftRecipients?: string[]
  delayDays?: number
}

type IntentLike = TokenIntentLike | NftIntentLike | null | undefined

export type CapsuleViewerRole = 'owner' | 'beneficiary' | 'none'

export type CapsuleDetailAccess = {
  role: CapsuleViewerRole
  releaseAtMs: number | null
  beneficiaryAddresses: string[]
  reason: string
}

export function getBeneficiaryAddresses(intent: IntentLike): string[] {
  if (!intent) return []

  if (intent.type === 'nft') {
    return Array.isArray(intent.nftRecipients)
      ? intent.nftRecipients.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : []
  }

  const tokenIntent = intent as TokenIntentLike
  return Array.isArray(tokenIntent.beneficiaries)
    ? tokenIntent.beneficiaries
      .filter((entry: { chain?: string; address?: string }) => (entry?.chain ?? 'solana') === 'solana')
      .map((entry: { chain?: string; address?: string }) => entry?.address?.trim() || '')
      .filter(Boolean)
    : []
}

export function getBeneficiaryReleaseAtMs(executedAtSeconds: number | null | undefined, delayDays: number | null | undefined): number | null {
  if (!executedAtSeconds || !Number.isFinite(executedAtSeconds)) return null
  const delay = Number.isFinite(delayDays) ? Math.max(0, Number(delayDays)) : 0
  return (executedAtSeconds + delay * 24 * 60 * 60) * 1000
}

export function getCapsuleDetailAccess(input: {
  ownerAddress: string
  viewerAddress?: string | null
  executedAtSeconds?: number | null
  intent?: IntentLike
  nowMs?: number
}): CapsuleDetailAccess {
  const {
    ownerAddress,
    viewerAddress,
    executedAtSeconds = null,
    intent,
    nowMs = Date.now(),
  } = input

  const beneficiaryAddresses = getBeneficiaryAddresses(intent)
  const delayDays = intent && 'delayDays' in intent && typeof intent.delayDays === 'number' ? intent.delayDays : 0
  const releaseAtMs = getBeneficiaryReleaseAtMs(executedAtSeconds, delayDays)
  const beneficiaryWindowOpen = Boolean(releaseAtMs && nowMs >= releaseAtMs)

  if (!viewerAddress) {
    return {
      role: 'none',
      releaseAtMs,
      beneficiaryAddresses,
      reason: 'Connect the authorized wallet to view capsule details.',
    }
  }

  if (viewerAddress === ownerAddress) {
    if (beneficiaryWindowOpen) {
      return {
        role: 'none',
        releaseAtMs,
        beneficiaryAddresses,
        reason: 'Beneficiary-only access is now active for this executed capsule.',
      }
    }

    return {
      role: 'owner',
      releaseAtMs,
      beneficiaryAddresses,
      reason: 'Owner access granted.',
    }
  }

  if (beneficiaryWindowOpen && beneficiaryAddresses.includes(viewerAddress)) {
    return {
      role: 'beneficiary',
      releaseAtMs,
      beneficiaryAddresses,
      reason: 'Beneficiary access granted after the post-execution delay elapsed.',
    }
  }

  return {
    role: 'none',
    releaseAtMs,
    beneficiaryAddresses,
    reason: beneficiaryWindowOpen
      ? 'This wallet is not an eligible beneficiary for capsule details.'
      : 'Capsule details stay private until the beneficiary release window opens.',
  }
}

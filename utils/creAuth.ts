export type CreSignedAction =
  | 'register-secret'
  | 'delivery-status'
  | 'dispatch'
  | 'stellar-settlement'
  | 'register-reminder'
  | 'reminder-status'

type BuildSignedMessageInput = {
  action: CreSignedAction
  owner: string
  timestamp: number
  capsuleAddress?: string
  recipientEmailHash?: string
  encryptedPayloadHash?: string
}

export function buildCreSignedMessage(input: BuildSignedMessageInput): string {
  const parts = [
    'Heres CRE Auth v1',
    `action:${input.action}`,
    `owner:${input.owner.trim()}`,
    `timestamp:${Math.trunc(input.timestamp)}`,
  ]

  if (input.capsuleAddress) {
    parts.push(`capsule:${input.capsuleAddress.trim()}`)
  }
  if (input.recipientEmailHash) {
    parts.push(`recipientEmailHash:${input.recipientEmailHash.trim().toLowerCase()}`)
  }
  if (input.encryptedPayloadHash) {
    parts.push(`encryptedPayloadHash:${input.encryptedPayloadHash.trim().toLowerCase()}`)
  }

  return parts.join('\n')
}

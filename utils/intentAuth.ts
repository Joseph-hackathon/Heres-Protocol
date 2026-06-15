export type IntentSignedAction =
  | 'register-secret'
  | 'delivery-status'
  | 'dispatch'
  | 'register-reminder'
  | 'reminder-status'

type BuildSignedMessageInput = {
  action: IntentSignedAction
  owner: string
  timestamp: number
  capsuleAddress?: string
  recipientEmailHash?: string
  messageHash?: string
}

export function buildIntentSignedMessage(input: BuildSignedMessageInput): string {
  const parts = [
    'Heres Intent Auth v1',
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
  if (input.messageHash) {
    parts.push(`messageHash:${input.messageHash.trim().toLowerCase()}`)
  }

  return parts.join('\n')
}

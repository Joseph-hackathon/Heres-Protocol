/**
 * Canonical message an admin wallet signs to prove control of an allowlisted key.
 * Shared by the client (signs it) and the server (rebuilds + verifies it), so the
 * exact byte layout must stay identical on both sides. Mirrors utils/intentAuth.ts.
 */
export type AdminSignedAction = 'admin-dashboard'

type BuildAdminSignedMessageInput = {
  action: AdminSignedAction
  owner: string
  timestamp: number
}

export function buildAdminSignedMessage(input: BuildAdminSignedMessageInput): string {
  return [
    'Heres Admin Auth v1',
    `action:${input.action}`,
    `owner:${input.owner.trim()}`,
    `timestamp:${Math.trunc(input.timestamp)}`,
  ].join('\n')
}

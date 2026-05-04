import 'server-only'

import { createHmac } from 'crypto'
import { PublicKey } from '@solana/web3.js'
import { parseIntentPayload } from '@/utils/intent'
import { safeEqualHex, sha256Hex } from '@/lib/cre/auth'
import {
  DispatchCreDeliveryResult,
  CreDeliveryLedgerRecord,
  CreDeliveryStatus,
} from '@/lib/cre/types'
import {
  getDeliveryLedger,
  getCreSecret,
  listDeliveryByCapsule,
  listCreSecrets,
  upsertDeliveryLedger,
  upsertCreSecret,
} from '@/lib/cre/store'
import { fetchCapsuleStateByAddress, fetchCapsuleStateByOwner } from '@/lib/cre/solana'

type RegisterSecretInput = {
  owner: string
  recipientEmail: string
  encryptedPayload: string
}

type CallbackInput = {
  idempotencyKey?: string
  capsuleAddress: string
  executedAt: number
  status: 'delivered' | 'failed'
  providerMessageId?: string
  error?: string
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function getRequiredEnv(name: string): string | null {
  const value = process.env[name]
  if (!value || !value.trim()) return null
  return value.trim()
}

function computeSecretHash(payload: string): string {
  return sha256Hex(payload)
}

function computeRecipientHash(email: string): string {
  return sha256Hex(normalizeEmail(email))
}

function createIdempotencyKey(capsuleAddress: string, executedAt: number): string {
  return `${capsuleAddress}:${executedAt}`
}

async function notifyOps(message: string): Promise<void> {
  const webhook = getRequiredEnv('OPS_ALERT_WEBHOOK_URL')
  if (!webhook) return
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
  } catch {
    // Avoid throwing from alerting path.
  }
}

async function callChainlinkWorkflow(payload: {
  idempotencyKey: string
  capsuleAddress: string
  owner: string
  executedAt: number
  recipientEmail: string
  secretRef: string
  secretHash: string
  encryptedPayload: string
}): Promise<void> {
  const webhook = getRequiredEnv('CHAINLINK_CRE_WEBHOOK_URL')
  if (!webhook) throw new Error('CHAINLINK_CRE_WEBHOOK_URL is not configured')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = getRequiredEnv('CHAINLINK_CRE_API_KEY')
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const signingSecret = getRequiredEnv('CHAINLINK_CRE_SIGNING_SECRET')
  if (signingSecret) {
    const signature = createHmac('sha256', signingSecret).update(JSON.stringify(payload)).digest('hex')
    headers['x-cre-signature'] = signature
  }

  const response = await fetch(webhook, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`CRE webhook error ${response.status}: ${body}`)
  }
}

export function registerCreSecret(input: RegisterSecretInput): {
  secretRef: string
  secretHash: string
  recipientEmailHash: string
} {
  const normalizedEmail = normalizeEmail(input.recipientEmail)
  const recipientEmailHash = computeRecipientHash(normalizedEmail)
  const secretRef = `sec_${crypto.randomUUID().replace(/-/g, '')}`
  const secretHash = computeSecretHash(input.encryptedPayload)
  const now = Date.now()

  upsertCreSecret({
    secretRef,
    secretHash,
    encryptedPayload: input.encryptedPayload,
    owner: input.owner,
    recipientEmail: normalizedEmail,
    recipientEmailHash,
    createdAt: now,
    updatedAt: now,
  })

  return { secretRef, secretHash, recipientEmailHash }
}

export async function dispatchCreDeliveryForCapsule(
  capsuleAddressRaw: string
): Promise<DispatchCreDeliveryResult> {
  let capsuleAddress: PublicKey
  try {
    capsuleAddress = new PublicKey(capsuleAddressRaw)
  } catch {
    return { ok: false, error: 'Invalid capsule address' }
  }

  const capsule = await fetchCapsuleStateByAddress(capsuleAddress)
  if (!capsule) return { ok: false, error: 'Capsule not found' }
  if (!capsule.executedAt) return { ok: true, skipped: true, reason: 'Capsule is not executed yet' }

  const parsed = parseIntentPayload(capsule.intentData)
  const cre =
    parsed && typeof parsed === 'object'
      ? ((parsed as { cre?: unknown }).cre ?? (parsed as { premium?: unknown }).premium)
      : undefined
  if (!cre || typeof cre !== 'object' || !(cre as { enabled?: boolean }).enabled) {
    return { ok: true, skipped: true, reason: 'CRE is not enabled' }
  }
  const creConfig = cre as {
    secretRef?: string
    secretHash?: string
    recipientEmailHash?: string
    recipientEmail?: string
  }
  const legacyRecipientEmail =
    typeof creConfig.recipientEmail === 'string'
      ? creConfig.recipientEmail
      : undefined
  const creRecipientHash =
    creConfig.recipientEmailHash || (legacyRecipientEmail ? computeRecipientHash(legacyRecipientEmail) : undefined)
  if (!creConfig.secretRef || !creConfig.secretHash || !creRecipientHash) {
    return { ok: false, error: 'CRE payload is incomplete' }
  }

  const idempotencyKey = createIdempotencyKey(capsule.capsuleAddress, capsule.executedAt)
  const existing = getDeliveryLedger(idempotencyKey)
  if (existing && (existing.status === 'dispatched' || existing.status === 'delivered' || existing.status === 'pending')) {
    return {
      ok: true,
      skipped: true,
      reason: `Already ${existing.status}`,
      idempotencyKey,
      status: existing.status,
      providerMessageId: existing.providerMessageId,
    }
  }

  const secret = getCreSecret(creConfig.secretRef)
  const nextAttempts = (existing?.attempts ?? 0) + 1

  if (!secret) {
    upsertDeliveryLedger(idempotencyKey, {
      capsuleAddress: capsule.capsuleAddress,
      owner: capsule.owner.toBase58(),
      executedAt: capsule.executedAt,
      secretRef: creConfig.secretRef,
      status: 'failed',
      attempts: nextAttempts,
      lastError: 'Secret ref not found in registry',
    })
    return { ok: false, error: 'Secret ref not found in registry', idempotencyKey, status: 'failed' }
  }

  if (secret.owner !== capsule.owner.toBase58()) {
    upsertDeliveryLedger(idempotencyKey, {
      capsuleAddress: capsule.capsuleAddress,
      owner: capsule.owner.toBase58(),
      executedAt: capsule.executedAt,
      recipientEmail: secret.recipientEmail,
      secretRef: creConfig.secretRef,
      status: 'failed',
      attempts: nextAttempts,
      lastError: 'Secret owner does not match capsule owner',
    })
    return { ok: false, error: 'Secret owner does not match capsule owner', idempotencyKey, status: 'failed' }
  }

  if (!safeEqualHex(secret.secretHash, creConfig.secretHash)) {
    upsertDeliveryLedger(idempotencyKey, {
      capsuleAddress: capsule.capsuleAddress,
      owner: capsule.owner.toBase58(),
      executedAt: capsule.executedAt,
      recipientEmail: secret.recipientEmail,
      secretRef: creConfig.secretRef,
      status: 'failed',
      attempts: nextAttempts,
      lastError: 'Secret hash mismatch',
    })
    return { ok: false, error: 'Secret hash mismatch', idempotencyKey, status: 'failed' }
  }

  if (!safeEqualHex(secret.recipientEmailHash, creRecipientHash)) {
    upsertDeliveryLedger(idempotencyKey, {
      capsuleAddress: capsule.capsuleAddress,
      owner: capsule.owner.toBase58(),
      executedAt: capsule.executedAt,
      recipientEmail: secret.recipientEmail,
      secretRef: creConfig.secretRef,
      status: 'failed',
      attempts: nextAttempts,
      lastError: 'Recipient email hash mismatch',
    })
    return { ok: false, error: 'Recipient email hash mismatch', idempotencyKey, status: 'failed' }
  }

  upsertDeliveryLedger(idempotencyKey, {
    capsuleAddress: capsule.capsuleAddress,
    owner: capsule.owner.toBase58(),
    executedAt: capsule.executedAt,
    recipientEmail: secret.recipientEmail,
    secretRef: creConfig.secretRef,
    status: 'pending',
    attempts: nextAttempts,
  })

  try {
    await callChainlinkWorkflow({
      idempotencyKey,
      recipientEmail: secret.recipientEmail,
      capsuleAddress: capsule.capsuleAddress,
      owner: capsule.owner.toBase58(),
      executedAt: capsule.executedAt,
      secretRef: creConfig.secretRef,
      secretHash: creConfig.secretHash,
      encryptedPayload: secret.encryptedPayload,
    })
    upsertDeliveryLedger(idempotencyKey, {
      capsuleAddress: capsule.capsuleAddress,
      owner: capsule.owner.toBase58(),
      executedAt: capsule.executedAt,
      recipientEmail: secret.recipientEmail,
      secretRef: creConfig.secretRef,
      status: 'dispatched',
      attempts: nextAttempts,
    })
    return { ok: true, idempotencyKey, status: 'dispatched' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    upsertDeliveryLedger(idempotencyKey, {
      capsuleAddress: capsule.capsuleAddress,
      owner: capsule.owner.toBase58(),
      executedAt: capsule.executedAt,
      recipientEmail: secret.recipientEmail,
      secretRef: creConfig.secretRef,
      status: 'failed',
      attempts: nextAttempts,
      lastError: message,
    })
    await notifyOps(`[Heres Intent Statement] Delivery failed: ${capsule.capsuleAddress} (${message})`)
    return { ok: false, error: message, idempotencyKey, status: 'failed' }
  }
}

export function applyCreDeliveryCallback(input: CallbackInput): CreDeliveryLedgerRecord {
  const idempotencyKey =
    input.idempotencyKey || createIdempotencyKey(input.capsuleAddress, Number(input.executedAt))
  const existing = getDeliveryLedger(idempotencyKey)

  return upsertDeliveryLedger(idempotencyKey, {
    capsuleAddress: input.capsuleAddress,
    owner: existing?.owner,
    executedAt: Number(input.executedAt),
    recipientEmail: existing?.recipientEmail,
    secretRef: existing?.secretRef,
    status: input.status as CreDeliveryStatus,
    attempts: existing?.attempts ?? 0,
    providerMessageId: input.providerMessageId,
    lastError: input.error,
  })
}

export function verifyCreCallbackSignature(rawBody: string, signature: string | null): boolean {
  const secret = getRequiredEnv('CHAINLINK_CRE_CALLBACK_SECRET')
  if (!secret) return true
  if (!signature) return false

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return safeEqualHex(expected, signature)
}

export function getDeliveryStatus(capsuleAddress: string): CreDeliveryLedgerRecord[] {
  return listDeliveryByCapsule(capsuleAddress)
}

export async function reconcileCreDeliveries(): Promise<{
  scanned: number
  executedCreCapsules: number
  dispatched: number
  failed: number
}> {
  const secrets = listCreSecrets()
  let executedCreCapsules = 0
  let dispatched = 0
  let failed = 0

  for (const secret of secrets) {
    let owner: PublicKey
    try {
      owner = new PublicKey(secret.owner)
    } catch {
      continue
    }

    const capsule = await fetchCapsuleStateByOwner(owner)
    if (!capsule?.executedAt) continue

    const parsed = parseIntentPayload(capsule.intentData)
    const cre =
      parsed && typeof parsed === 'object'
        ? ((parsed as { cre?: unknown }).cre ?? (parsed as { premium?: unknown }).premium)
        : undefined
    const creSecretRef = typeof cre === 'object' && cre ? (cre as { secretRef?: unknown }).secretRef : undefined
    const creEnabled = typeof cre === 'object' && cre ? Boolean((cre as { enabled?: boolean }).enabled) : false
    if (!creEnabled || typeof creSecretRef !== 'string' || creSecretRef !== secret.secretRef) continue

    executedCreCapsules += 1
    const result = await dispatchCreDeliveryForCapsule(capsule.capsuleAddress)
    if (result.ok && !result.skipped) dispatched += 1
    if (!result.ok) failed += 1
  }

  return {
    scanned: secrets.length,
    executedCreCapsules,
    dispatched,
    failed,
  }
}

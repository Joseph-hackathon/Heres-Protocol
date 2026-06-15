import 'server-only'

import { randomUUID } from 'crypto'
import { PublicKey } from '@solana/web3.js'
import { sha256Hex } from '@/lib/cre/auth'
import { encryptAtRest, decryptAtRest } from '@/lib/cre/at-rest'
import { sendEmail } from '@/lib/cre/email'
import { renderIntentEmail } from '@/lib/cre/email-templates'
import { DispatchCreDeliveryResult, CreDeliveryLedgerRecord } from '@/lib/cre/types'
import {
  acquireDeliveryLock,
  releaseDeliveryLock,
  getDeliveryLedger,
  getCreSecret,
  getCreSecretByOwner,
  listDeliveryByCapsule,
  listCreSecrets,
  upsertDeliveryLedger,
  upsertCreSecret,
} from '@/lib/cre/store'
import { fetchCapsuleStateByAddress, fetchCapsuleStateByOwner } from '@/lib/cre/solana'

// Reliability knobs for the self-hosted delivery engine.
const MAX_ATTEMPTS = 8
const LOCK_TTL_SECONDS = 120
const BASE_BACKOFF_MS = 5 * 60 * 1000 // 5 minutes
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000 // 24 hours

type RegisterSecretInput = {
  owner: string
  recipientEmail: string
  // Plaintext intent statement. The server encrypts it at rest; the previous
  // client-side, access-code-derived ciphertext is gone (undecryptable once the
  // owner is silent - see lib/cre/at-rest.ts).
  message: string
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function getRequiredEnv(name: string): string | null {
  const value = process.env[name]
  if (!value || !value.trim()) return null
  return value.trim()
}

function createIdempotencyKey(capsuleAddress: string, executedAt: number): string {
  return `${capsuleAddress}:${executedAt}`
}

function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1))
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
    // Never throw from the alerting path.
  }
}

export async function registerCreSecret(input: RegisterSecretInput): Promise<{
  secretRef: string
  secretHash: string
  recipientEmailHash: string
}> {
  const normalizedEmail = normalizeEmail(input.recipientEmail)
  const recipientEmailHash = sha256Hex(normalizedEmail)
  const secretRef = `sec_${randomUUID().replace(/-/g, '')}`
  // Encrypt the statement at rest with a server-held key, then store only the
  // ciphertext. secretHash is an integrity tag over the stored ciphertext.
  const encryptedPayload = encryptAtRest(input.message)
  const secretHash = sha256Hex(encryptedPayload)
  const now = Date.now()

  await upsertCreSecret({
    secretRef,
    secretHash,
    encryptedPayload,
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

  // Intent delivery is enabled off-chain: a registered secret exists for the
  // capsule owner (the lean on-chain capsule carries no intent_data).
  const ownerStr = capsule.owner.toBase58()
  const registeredSecret = await getCreSecretByOwner(ownerStr)
  if (!registeredSecret) {
    return { ok: true, skipped: true, reason: 'Intent delivery is not enabled' }
  }

  const idempotencyKey = createIdempotencyKey(capsule.capsuleAddress, capsule.executedAt)

  // Atomic claim so concurrent cron invocations cannot double-send.
  const claimed = await acquireDeliveryLock(idempotencyKey, LOCK_TTL_SECONDS)
  if (!claimed) {
    return { ok: true, skipped: true, reason: 'Delivery in progress', idempotencyKey }
  }

  try {
    const existing = await getDeliveryLedger(idempotencyKey)
    if (existing && (existing.status === 'delivered' || existing.status === 'dispatched')) {
      return {
        ok: true,
        skipped: true,
        reason: `Already ${existing.status}`,
        idempotencyKey,
        status: existing.status,
        providerMessageId: existing.providerMessageId,
      }
    }
    if (existing && existing.status === 'dead_letter') {
      return { ok: true, skipped: true, reason: 'Delivery dead-lettered', idempotencyKey, status: 'dead_letter' }
    }
    if (existing && existing.status === 'failed' && existing.nextAttemptAt && Date.now() < existing.nextAttemptAt) {
      return { ok: true, skipped: true, reason: 'Backing off before retry', idempotencyKey, status: 'failed' }
    }

    const secret = await getCreSecret(registeredSecret.secretRef)
    const attempts = (existing?.attempts ?? 0) + 1

    if (!secret) {
      await upsertDeliveryLedger(idempotencyKey, {
        capsuleAddress: capsule.capsuleAddress,
        owner: ownerStr,
        executedAt: capsule.executedAt,
        secretRef: registeredSecret.secretRef,
        status: 'failed',
        attempts,
        nextAttemptAt: Date.now() + backoffMs(attempts),
        lastError: 'Secret ref not found in store',
      })
      return { ok: false, error: 'Secret ref not found in store', idempotencyKey, status: 'failed' }
    }

    if (secret.owner !== ownerStr) {
      await upsertDeliveryLedger(idempotencyKey, {
        capsuleAddress: capsule.capsuleAddress,
        owner: ownerStr,
        executedAt: capsule.executedAt,
        recipientEmail: secret.recipientEmail,
        secretRef: registeredSecret.secretRef,
        status: 'dead_letter',
        attempts,
        lastError: 'Secret owner does not match capsule owner',
      })
      await notifyOps(`[Heres Intent] Owner mismatch for ${capsule.capsuleAddress}; dead-lettered`)
      return { ok: false, error: 'Secret owner does not match capsule owner', idempotencyKey, status: 'dead_letter' }
    }

    await upsertDeliveryLedger(idempotencyKey, {
      capsuleAddress: capsule.capsuleAddress,
      owner: ownerStr,
      executedAt: capsule.executedAt,
      recipientEmail: secret.recipientEmail,
      secretRef: registeredSecret.secretRef,
      status: 'pending',
      attempts,
    })

    // Decrypt at rest. A failure here is permanent (wrong key / corrupt blob),
    // so dead-letter immediately rather than burning retries.
    let message: string
    try {
      message = decryptAtRest(secret.encryptedPayload)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      await upsertDeliveryLedger(idempotencyKey, {
        capsuleAddress: capsule.capsuleAddress,
        owner: ownerStr,
        executedAt: capsule.executedAt,
        recipientEmail: secret.recipientEmail,
        secretRef: registeredSecret.secretRef,
        status: 'dead_letter',
        attempts,
        lastError: `At-rest decrypt failed: ${detail}`,
      })
      await notifyOps(`[Heres Intent] At-rest decrypt failed for ${capsule.capsuleAddress}; dead-lettered`)
      return { ok: false, error: 'At-rest decrypt failed', idempotencyKey, status: 'dead_letter' }
    }

    try {
      const { subject, html, text } = renderIntentEmail({
        message,
        capsuleAddress: capsule.capsuleAddress,
      })
      const { providerMessageId } = await sendEmail({ to: secret.recipientEmail, subject, html, text })
      await upsertDeliveryLedger(idempotencyKey, {
        capsuleAddress: capsule.capsuleAddress,
        owner: ownerStr,
        executedAt: capsule.executedAt,
        recipientEmail: secret.recipientEmail,
        secretRef: registeredSecret.secretRef,
        status: 'delivered',
        attempts,
        providerMessageId,
      })
      return { ok: true, idempotencyKey, status: 'delivered', providerMessageId }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const exhausted = attempts >= MAX_ATTEMPTS
      await upsertDeliveryLedger(idempotencyKey, {
        capsuleAddress: capsule.capsuleAddress,
        owner: ownerStr,
        executedAt: capsule.executedAt,
        recipientEmail: secret.recipientEmail,
        secretRef: registeredSecret.secretRef,
        status: exhausted ? 'dead_letter' : 'failed',
        attempts,
        nextAttemptAt: exhausted ? undefined : Date.now() + backoffMs(attempts),
        lastError: detail,
      })
      if (exhausted) {
        await notifyOps(
          `[Heres Intent] Delivery dead-lettered after ${attempts} attempts: ${capsule.capsuleAddress} (${detail})`
        )
      }
      return {
        ok: false,
        error: detail,
        idempotencyKey,
        status: exhausted ? 'dead_letter' : 'failed',
      }
    }
  } finally {
    await releaseDeliveryLock(idempotencyKey)
  }
}

export async function getDeliveryStatus(capsuleAddress: string): Promise<CreDeliveryLedgerRecord[]> {
  return listDeliveryByCapsule(capsuleAddress)
}

export async function reconcileCreDeliveries(): Promise<{
  scanned: number
  executedCreCapsules: number
  dispatched: number
  failed: number
}> {
  const secrets = await listCreSecrets()
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

    // Only act on the most recently registered secret per owner (matches dispatch).
    const latest = await getCreSecretByOwner(secret.owner)
    if (!latest || latest.secretRef !== secret.secretRef) continue

    executedCreCapsules += 1
    const result = await dispatchCreDeliveryForCapsule(capsule.capsuleAddress)
    if (result.ok && !result.skipped) dispatched += 1
    if (!result.ok) failed += 1
  }

  return { scanned: secrets.length, executedCreCapsules, dispatched, failed }
}

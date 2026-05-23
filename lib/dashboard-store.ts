import { createHash } from 'crypto'
import type { DashboardCapsuleEvent, DashboardSnapshot } from '@/lib/dashboard'
import { debugWarn } from '@/lib/log'
import { ensurePostgresSchema, isPostgresConfigured, pgQuery, safePgQuery } from '@/lib/postgres'

type IngestionRow = {
  id: number
  event_hash: string
  payload: unknown
  headers: Record<string, string>
  verified: boolean
}

function hashSecret(value: string | null | undefined): string | null {
  if (!value) return null
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    sanitized[key] = key.toLowerCase() === 'authorization' ? '[redacted]' : value
  }
  return sanitized
}

function parseWebhookPayload(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody)
  } catch {
    return {
      invalidJson: true,
      rawBodyPreview: rawBody.slice(0, 2048),
    }
  }
}

export async function loadDurableSnapshot(cacheKey: string): Promise<{ value: DashboardSnapshot; updatedAt: number } | null> {
  if (!isPostgresConfigured()) return null
  const result = await safePgQuery<{ snapshot: DashboardSnapshot; updated_at: Date }>(
    'SELECT snapshot, updated_at FROM dashboard_snapshots WHERE cache_key = $1 LIMIT 1',
    [cacheKey]
  )
  const row = result?.rows?.[0]
  if (!row) return null
  return {
    value: row.snapshot,
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

export async function saveDurableSnapshot(cacheKey: string, snapshot: DashboardSnapshot): Promise<void> {
  if (!isPostgresConfigured()) return
  await ensurePostgresSchema()
  await pgQuery(
    `INSERT INTO dashboard_snapshots (cache_key, snapshot, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (cache_key)
     DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = NOW()`,
    [cacheKey, JSON.stringify(snapshot)]
  )
}

function buildEventId(event: { signature: string; label: string; capsuleAddress: string }): string {
  return `${event.signature}:${event.label}:${event.capsuleAddress}`
}

export async function persistDashboardIndex(snapshot: DashboardSnapshot): Promise<void> {
  if (!isPostgresConfigured()) return
  await ensurePostgresSchema()

  const capsuleRows = snapshot.capsules.filter((row) => row.kind === 'capsule')
  const eventRows = snapshot.capsules.filter((row) => row.kind === 'event')

  const capsulePromises = capsuleRows.map((row) =>
    pgQuery(
      `INSERT INTO dashboard_capsules (
        capsule_address, row_kind, owner_address, status, inactivity_seconds, last_activity_ms,
        executed_at_ms, payload_size, signature, is_active, is_delegated, token_delta, sol_delta,
        proof_bytes, event_count, data, indexed_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,NOW()
      )
      ON CONFLICT (capsule_address)
      DO UPDATE SET
        row_kind = EXCLUDED.row_kind,
        owner_address = EXCLUDED.owner_address,
        status = EXCLUDED.status,
        inactivity_seconds = EXCLUDED.inactivity_seconds,
        last_activity_ms = EXCLUDED.last_activity_ms,
        executed_at_ms = EXCLUDED.executed_at_ms,
        payload_size = EXCLUDED.payload_size,
        signature = EXCLUDED.signature,
        is_active = EXCLUDED.is_active,
        is_delegated = EXCLUDED.is_delegated,
        token_delta = EXCLUDED.token_delta,
        sol_delta = EXCLUDED.sol_delta,
        proof_bytes = EXCLUDED.proof_bytes,
        event_count = EXCLUDED.event_count,
        data = EXCLUDED.data,
        indexed_at = NOW()`,
      [
        row.capsuleAddress,
        row.kind,
        row.owner,
        row.status,
        row.inactivitySeconds,
        row.lastActivityMs,
        row.executedAtMs,
        row.payloadSize,
        row.signature,
        row.isActive,
        row.isDelegated,
        row.tokenDelta,
        row.solDelta,
        row.proofBytes,
        row.events.length,
        JSON.stringify(row),
      ]
    )
  )

  const eventPayloads = [...eventRows, ...capsuleRows.flatMap((row) => row.events.map((event) => ({ row, event })))]
  const eventPromises = eventPayloads.map((entry: any) => {
    const rawEvent = entry.event ? entry.event : entry
    const capsuleAddress = entry.row?.capsuleAddress || rawEvent.capsuleAddress || rawEvent.id || 'unknown-capsule'
    const normalizedEvent = {
      signature: rawEvent.signature || `${capsuleAddress}:${rawEvent.lastActivityMs || rawEvent.executedAtMs || Date.now()}`,
      label: rawEvent.label || rawEvent.status || rawEvent.kind || 'event',
      status: rawEvent.status || 'unknown',
      blockTime:
        typeof rawEvent.blockTime === 'number'
          ? rawEvent.blockTime
          : typeof rawEvent.lastActivityMs === 'number'
            ? Math.floor(rawEvent.lastActivityMs / 1000)
            : typeof rawEvent.executedAtMs === 'number'
              ? Math.floor(rawEvent.executedAtMs / 1000)
              : null,
      capsuleAddress,
      owner: rawEvent.owner || null,
      tokenDelta: rawEvent.tokenDelta || null,
      solDelta: rawEvent.solDelta ?? null,
      proofBytes: rawEvent.proofBytes ?? null,
    }

    return pgQuery(
      `INSERT INTO dashboard_events (
        event_id, capsule_address, signature, label, status, block_time, owner_address,
        token_delta, sol_delta, proof_bytes, payload, indexed_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW()
      )
      ON CONFLICT (event_id)
      DO UPDATE SET
        capsule_address = EXCLUDED.capsule_address,
        signature = EXCLUDED.signature,
        label = EXCLUDED.label,
        status = EXCLUDED.status,
        block_time = EXCLUDED.block_time,
        owner_address = EXCLUDED.owner_address,
        token_delta = EXCLUDED.token_delta,
        sol_delta = EXCLUDED.sol_delta,
        proof_bytes = EXCLUDED.proof_bytes,
        payload = EXCLUDED.payload,
        indexed_at = NOW()`,
      [
        buildEventId(normalizedEvent),
        capsuleAddress,
        normalizedEvent.signature,
        normalizedEvent.label,
        normalizedEvent.status,
        normalizedEvent.blockTime ? normalizedEvent.blockTime * 1000 : null,
        normalizedEvent.owner,
        normalizedEvent.tokenDelta,
        normalizedEvent.solDelta,
        normalizedEvent.proofBytes,
        JSON.stringify(normalizedEvent),
      ]
    )
  })

  await Promise.all([...capsulePromises, ...eventPromises])

  await pgQuery(
    `INSERT INTO dashboard_sync_state (state_key, state_value, updated_at)
     VALUES ('dashboard:last_snapshot', $1::jsonb, NOW())
     ON CONFLICT (state_key)
     DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = NOW()`,
    [
      JSON.stringify({
        timestamp: snapshot.timestamp,
        capsules: snapshot.capsules.length,
        historyLoaded: snapshot.historyLoaded,
        complete: snapshot.complete,
      }),
    ]
  )
}

export async function enqueueRpcIngestion(rawBody: string, headers: Record<string, string>, verified: boolean): Promise<void> {
  if (!isPostgresConfigured()) return
  await ensurePostgresSchema()

  const eventHash = createHash('sha256').update(rawBody).digest('hex')
  const payload = parseWebhookPayload(rawBody)
  const sanitizedHeaders = sanitizeHeaders(headers)
  const hashedAuthorization = hashSecret(headers.authorization || null)

  await pgQuery(
    `INSERT INTO rpc_ingestion_logs (event_hash, verified, authorization_value, payload, headers)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     ON CONFLICT (event_hash) DO NOTHING`,
    [eventHash, verified, hashedAuthorization, JSON.stringify(payload), JSON.stringify(sanitizedHeaders)]
  )
}

export async function claimPendingIngestionLogs(limit = 25): Promise<IngestionRow[]> {
  if (!isPostgresConfigured()) return []
  await ensurePostgresSchema()
  const result = await pgQuery<IngestionRow>(
    `WITH next_batch AS (
      SELECT id
      FROM rpc_ingestion_logs
      WHERE processed = FALSE
        AND verified = TRUE
        AND processing_started_at IS NULL
      ORDER BY received_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE rpc_ingestion_logs logs
    SET processing_started_at = NOW(), processing_error = NULL
    FROM next_batch
    WHERE logs.id = next_batch.id
    RETURNING logs.id, logs.event_hash, logs.payload, logs.headers, logs.verified`,
    [limit]
  )
  return result.rows
}

export async function completeIngestionLog(id: number): Promise<void> {
  if (!isPostgresConfigured()) return
  await pgQuery(
    `UPDATE rpc_ingestion_logs
     SET processed = TRUE, processed_at = NOW(), processing_error = NULL
     WHERE id = $1`,
    [id]
  )
}

export async function failIngestionLog(id: number, errorMessage: string): Promise<void> {
  if (!isPostgresConfigured()) return
  await pgQuery(
    `UPDATE rpc_ingestion_logs
     SET processing_started_at = NULL, processing_error = $2
     WHERE id = $1`,
    [id, errorMessage.slice(0, 1000)]
  )
}

export async function getIngestionBacklogCount(): Promise<number> {
  if (!isPostgresConfigured()) return 0
  const result = await safePgQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM rpc_ingestion_logs WHERE processed = FALSE AND verified = TRUE`
  )
  return Number(result?.rows?.[0]?.count || 0)
}

export async function saveSyncCheckpoint(key: string, value: unknown): Promise<void> {
  if (!isPostgresConfigured()) return
  await pgQuery(
    `INSERT INTO dashboard_sync_state (state_key, state_value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (state_key)
     DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  )
}

export async function loadSyncCheckpoint<T>(key: string): Promise<T | null> {
  if (!isPostgresConfigured()) return null
  const result = await safePgQuery<{ state_value: T }>(
    'SELECT state_value FROM dashboard_sync_state WHERE state_key = $1 LIMIT 1',
    [key]
  )
  return result?.rows?.[0]?.state_value ?? null
}

export async function withPostgresSafety<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch (error) {
    debugWarn('[dashboard-store] postgres operation failed', error)
    return fallback
  }
}



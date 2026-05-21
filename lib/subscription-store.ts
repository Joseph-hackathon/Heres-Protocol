import { pgQuery, safePgQuery, ensurePostgresSchema } from '@/lib/postgres'

export interface CapsuleSubscription {
  capsule_address: string
  owner_address: string
  monitoring_enabled: boolean
  payment_method: 'stripe' | 'web3_stream' | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stream_id: string | null
  status: 'active' | 'canceled' | 'paused' | 'inactive' | 'trialing' | 'past_due' | 'unpaid' | 'incomplete' | 'incomplete_expired'
  current_period_end: Date | null
  created_at: Date
  updated_at: Date
}

export async function getCapsuleSubscription(
  capsuleAddress: string
): Promise<CapsuleSubscription | null> {
  await ensurePostgresSchema()
  const result = await safePgQuery<CapsuleSubscription>(
    `SELECT * FROM capsule_subscriptions WHERE capsule_address = $1 LIMIT 1`,
    [capsuleAddress]
  )
  return result?.rows?.[0] || null
}

export async function getSubscriptionsByOwner(
  ownerAddress: string
): Promise<CapsuleSubscription[]> {
  await ensurePostgresSchema()
  const result = await safePgQuery<CapsuleSubscription>(
    `SELECT * FROM capsule_subscriptions WHERE owner_address = $1`,
    [ownerAddress]
  )
  return result?.rows || []
}

export async function upsertStripeSubscription(
  capsuleAddress: string,
  ownerAddress: string,
  customerId: string | null,
  subscriptionId: string | null,
  status: string,
  currentPeriodEnd: Date | null
): Promise<void> {
  await ensurePostgresSchema()
  await pgQuery(
    `INSERT INTO capsule_subscriptions (
      capsule_address, owner_address, monitoring_enabled, payment_method,
      stripe_customer_id, stripe_subscription_id, status, current_period_end, updated_at
    ) VALUES ($1, $2, TRUE, 'stripe', $3, $4, $5, $6, NOW())
    ON CONFLICT (capsule_address) DO UPDATE SET
      owner_address = EXCLUDED.owner_address,
      monitoring_enabled = TRUE,
      payment_method = 'stripe',
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      updated_at = NOW()`,
    [capsuleAddress, ownerAddress, customerId, subscriptionId, status, currentPeriodEnd]
  )
}

export async function updateStripeSubscriptionStatus(
  subscriptionId: string,
  status: string,
  currentPeriodEnd: Date | null
): Promise<void> {
  await ensurePostgresSchema()
  await pgQuery(
    `UPDATE capsule_subscriptions
     SET status = $2, current_period_end = $3, updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [subscriptionId, status, currentPeriodEnd]
  )
}

export async function upsertWeb3StreamSubscription(
  capsuleAddress: string,
  ownerAddress: string,
  streamId: string,
  status: string,
  currentPeriodEnd: Date | null
): Promise<void> {
  await ensurePostgresSchema()
  await pgQuery(
    `INSERT INTO capsule_subscriptions (
      capsule_address, owner_address, monitoring_enabled, payment_method,
      stream_id, status, current_period_end, updated_at
    ) VALUES ($1, $2, TRUE, 'web3_stream', $3, $4, $5, NOW())
    ON CONFLICT (capsule_address) DO UPDATE SET
      owner_address = EXCLUDED.owner_address,
      monitoring_enabled = TRUE,
      payment_method = 'web3_stream',
      stream_id = EXCLUDED.stream_id,
      status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      updated_at = NOW()`,
    [capsuleAddress, ownerAddress, streamId, status, currentPeriodEnd]
  )
}

export async function disableMonitoring(capsuleAddress: string): Promise<void> {
  await ensurePostgresSchema()
  await pgQuery(
    `UPDATE capsule_subscriptions
     SET monitoring_enabled = FALSE, status = 'inactive', updated_at = NOW()
     WHERE capsule_address = $1`,
    [capsuleAddress]
  )
}

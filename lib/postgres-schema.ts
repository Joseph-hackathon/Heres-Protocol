export const POSTGRES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  cache_key TEXT PRIMARY KEY,
  snapshot JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dashboard_capsules (
  capsule_address TEXT PRIMARY KEY,
  row_kind TEXT NOT NULL,
  owner_address TEXT,
  status TEXT NOT NULL,
  inactivity_seconds BIGINT,
  last_activity_ms BIGINT,
  executed_at_ms BIGINT,
  payload_size INTEGER,
  signature TEXT,
  is_active BOOLEAN,
  is_delegated BOOLEAN NOT NULL DEFAULT FALSE,
  token_delta TEXT,
  sol_delta DOUBLE PRECISION,
  proof_bytes INTEGER,
  event_count INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_capsules_owner ON dashboard_capsules (owner_address);
CREATE INDEX IF NOT EXISTS idx_dashboard_capsules_status ON dashboard_capsules (status);
CREATE INDEX IF NOT EXISTS idx_dashboard_capsules_last_activity ON dashboard_capsules (last_activity_ms DESC);

CREATE TABLE IF NOT EXISTS dashboard_events (
  event_id TEXT PRIMARY KEY,
  capsule_address TEXT NOT NULL,
  signature TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  block_time BIGINT,
  owner_address TEXT,
  token_delta TEXT,
  sol_delta DOUBLE PRECISION,
  proof_bytes INTEGER,
  payload JSONB NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_events_capsule ON dashboard_events (capsule_address);
CREATE INDEX IF NOT EXISTS idx_dashboard_events_signature ON dashboard_events (signature);
CREATE INDEX IF NOT EXISTS idx_dashboard_events_block_time ON dashboard_events (block_time DESC);

CREATE TABLE IF NOT EXISTS dashboard_sync_state (
  state_key TEXT PRIMARY KEY,
  state_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capsule_owner_registry (
  owner_address TEXT PRIMARY KEY,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS helius_webhook_logs (
  id BIGSERIAL PRIMARY KEY,
  event_hash TEXT NOT NULL UNIQUE,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  authorization_value TEXT,
  payload JSONB NOT NULL,
  headers JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  processing_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_helius_webhook_logs_pending
  ON helius_webhook_logs (processed, processing_started_at, received_at);

CREATE TABLE IF NOT EXISTS capsule_subscriptions (
  capsule_address TEXT PRIMARY KEY,
  owner_address TEXT NOT NULL,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payment_method TEXT, -- 'stripe' or 'web3_stream'
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stream_id TEXT, -- Streamflow stream public key / address
  status TEXT NOT NULL DEFAULT 'inactive', -- 'active', 'canceled', 'paused', 'inactive'
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capsule_subscriptions_status ON capsule_subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_capsule_subscriptions_owner ON capsule_subscriptions (owner_address);
`

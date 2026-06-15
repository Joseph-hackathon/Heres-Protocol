/// <reference types="next" />
/// <reference types="next/image-types/global" />

declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_SOLANA_NETWORK?: string
    NEXT_PUBLIC_HELIUS_API_KEY?: string
    NEXT_PUBLIC_SOLANA_FALLBACK_RPC_URL?: string
    SOLANA_RPC_URL?: string
    SOLANA_FALLBACK_RPC_URL?: string
    NEXT_PUBLIC_PROGRAM_ID?: string
    NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT?: string
    APP_BASE_URL?: string
    INDEXER_BASE_URL?: string
    DATABASE_URL?: string
    HELIUS_WEBHOOK_AUTH_TOKEN?: string
    // Self-hosted intent-delivery engine (replaces Chainlink CRE).
    INTENT_AT_REST_KEY?: string
    RESEND_API_KEY?: string
    RESEND_FROM?: string
    NEXT_PUBLIC_APP_URL?: string
    INTENT_REMINDER_DISPATCH_SECRET?: string
    INTENT_REMINDER_INTERVAL_DAYS?: string
    OPS_ALERT_WEBHOOK_URL?: string
    CRON_SECRET?: string
    DASHBOARD_PREWARM_TOKEN?: string
    DASHBOARD_PREWARM_ENABLED?: string
    DASHBOARD_PREWARM_PAGES?: string
    INTENT_DISPATCH_SECRET?: string
    INTENT_STORE_PATH?: string
    UPSTASH_REDIS_REST_URL?: string
    UPSTASH_REDIS_REST_TOKEN?: string
  }
}

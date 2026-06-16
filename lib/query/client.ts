import { QueryClient } from '@tanstack/react-query'

/**
 * Factory for the app-wide QueryClient.
 *
 * All reads here are Solana RPC / Helius / CoinGecko calls, so the defaults are
 * tuned to avoid hammering rate-limited endpoints: a non-zero staleTime, a single
 * retry, and no refetch-on-focus. Per-query overrides (e.g. the 5-minute dashboard
 * snapshot, the 120s price tick) live in the individual hooks.
 *
 * Instantiate once per browser session via `useState(() => makeQueryClient())` in
 * the client provider so a fresh client is never shared across server requests.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000, // 1 min: most on-chain reads tolerate this
        gcTime: 10 * 60_000, // keep unused data 10 min before garbage-collecting
        retry: 1, // RPC can blip; one retry, then surface the error
        refetchOnWindowFocus: false, // never refetch RPC just because a tab refocused
        refetchOnReconnect: true,
      },
    },
  })
}

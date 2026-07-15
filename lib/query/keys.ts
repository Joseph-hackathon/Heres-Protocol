/**
 * Central query-key factory. Every React Query read keys off this so invalidation
 * and prefetching stay consistent and typo-proof. Keys are hierarchical: invalidating
 * `queryKeys.capsule.all` drops every capsule-scoped query.
 *
 * Note on TEE-authed reads: the capsule query is keyed by address only, NOT by the
 * TEE token. The token is auth, not identity - an owner "reveal" mints a fresh token
 * and refetches the same key, replacing the public snapshot with the private one.
 */
export const queryKeys = {
  dashboard: {
    all: ['dashboard'] as const,
    data: () => [...queryKeys.dashboard.all, 'data'] as const,
    summary: () => [...queryKeys.dashboard.all, 'summary'] as const,
    feeConfig: () => [...queryKeys.dashboard.all, 'feeConfig'] as const,
  },
  capsule: {
    all: ['capsule'] as const,
    byAddress: (address: string) => [...queryKeys.capsule.all, 'byAddress', address] as const,
    byOwner: (owner: string) => [...queryKeys.capsule.all, 'byOwner', owner] as const,
    accountLocations: (owner: string) => [...queryKeys.capsule.all, 'accountLocations', owner] as const,
    meta: (address: string) => [...queryKeys.capsule.all, 'meta', address] as const,
    vaultMint: (owner: string) => [...queryKeys.capsule.all, 'vaultMint', owner] as const,
    vaultAssets: (owner: string) => [...queryKeys.capsule.all, 'vaultAssets', owner] as const,
    distribution: (address: string) => [...queryKeys.capsule.all, 'distribution', address] as const,
    intentDelivery: (address: string) => [...queryKeys.capsule.all, 'intentDelivery', address] as const,
  },
  price: {
    all: ['price'] as const,
    current: (coingeckoId: string) => [...queryKeys.price.all, 'current', coingeckoId] as const,
    chart: (coingeckoId: string, range: string) =>
      [...queryKeys.price.all, 'chart', coingeckoId, range] as const,
  },
  wallet: {
    all: ['wallet'] as const,
    tokens: (owner: string) => [...queryKeys.wallet.all, 'tokens', owner] as const,
    nfts: (owner: string) => [...queryKeys.wallet.all, 'nfts', owner] as const,
    balance: (owner: string) => [...queryKeys.wallet.all, 'balance', owner] as const,
  },
} as const

'use client'

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { PrivyProvider } from '@privy-io/react-auth'
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { useMemo, ReactNode } from 'react'
import { SOLANA_CONFIG } from '@/constants'
import { PrivySolanaWalletAutoConnect, PrivySolanaWalletRegistrar } from '@/components/PrivySolanaWalletBridge'

export function Providers({ children }: { children: ReactNode }) {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_FALLBACK_RPC_URL || 'https://api.devnet.solana.com',
    []
  )
  const wsEndpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_WS_URL || endpoint.replace(/^http/, 'ws'),
    [endpoint]
  )
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
  const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID

  const wallets = useMemo(() => [], [])
  const privySolanaChain = `solana:${SOLANA_CONFIG.NETWORK === 'mainnet-beta' ? 'mainnet' : SOLANA_CONFIG.NETWORK}` as 'solana:mainnet' | 'solana:devnet' | 'solana:testnet'

  const app = (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        {privyAppId && <PrivySolanaWalletAutoConnect />}
        {children}
      </WalletProvider>
    </ConnectionProvider>
  )

  if (!privyAppId) return app

  return (
    <PrivyProvider
      appId={privyAppId}
      clientId={privyClientId}
      config={{
        solana: {
          rpcs: {
            [privySolanaChain]: {
              rpc: createSolanaRpc(endpoint as `${string}://${string}`),
              rpcSubscriptions: createSolanaRpcSubscriptions(wsEndpoint as `${string}://${string}`),
            },
          } as any,
        },
        appearance: {
          theme: '#071326',
          accentColor: '#22d3ee',
          landingHeader: 'Connect to Heres',
          loginMessage: 'Use one account for Solana and Stellar capsule flows.',
          walletChainType: 'solana-only',
        },
        loginMethods: ['wallet', 'email', 'google'],
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }),
          },
        },
        embeddedWallets: {
          solana: { createOnLogin: 'users-without-wallets' },
        },
      }}
    >
      <PrivySolanaWalletRegistrar />
      {app}
    </PrivyProvider>
  )
}

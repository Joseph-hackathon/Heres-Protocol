'use client'

import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { useMemo, ReactNode } from 'react'
import { SOLANA_CONFIG } from '@/constants'
import '@solana/wallet-adapter-react-ui/styles.css'

export function Providers({ children }: { children: ReactNode }) {
  const network = useMemo(() => {
    switch (SOLANA_CONFIG.NETWORK) {
      case 'mainnet-beta':
        return WalletAdapterNetwork.Mainnet
      case 'testnet':
        return WalletAdapterNetwork.Testnet
      case 'devnet':
      default:
        return WalletAdapterNetwork.Devnet
    }
  }, [])

  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_FALLBACK_RPC_URL || 'https://api.devnet.solana.com',
    []
  )
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
  const privyClientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network }),
    ],
    [network]
  )

  const app = (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )

  if (!privyAppId) return app

  return (
    <PrivyProvider
      appId={privyAppId}
      clientId={privyClientId}
      config={{
        appearance: {
          theme: '#071326',
          accentColor: '#22d3ee',
          landingHeader: 'Connect to Heres',
          loginMessage: 'Use one account for Solana, EVM, and Stellar settlement flows.',
          walletChainType: 'ethereum-and-solana',
        },
        loginMethods: ['wallet', 'email', 'google'],
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }),
          },
        },
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
          solana: { createOnLogin: 'users-without-wallets' },
        },
      }}
    >
      {app}
    </PrivyProvider>
  )
}

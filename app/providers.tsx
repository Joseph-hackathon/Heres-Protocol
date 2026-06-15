'use client'

import { WalletAdapterNetwork, WalletError } from '@solana/wallet-adapter-base'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { useCallback, useMemo, ReactNode } from 'react'
import { HELIUS_CONFIG, SOLANA_CONFIG } from '@/constants'
import { debugWarn } from '@/lib/log'
import { ToastProvider } from '@/components/ui'
import '@solana/wallet-adapter-react-ui/styles.css'

// Benign wallet lifecycle events: the user disconnected/switched accounts from the
// wallet UI, closed the connect modal, or no wallet is selected yet. The adapter
// already reconciles its own state for these; without a custom onError, wallet-adapter
// logs them via console.error, which the Next.js dev overlay promotes to a blocking
// error. Matched by name to stay robust across duplicate base-package copies.
const BENIGN_WALLET_ERRORS = new Set([
  'WalletDisconnectedError',
  'WalletNotSelectedError',
  'WalletNotConnectedError',
  'WalletWindowClosedError',
  'WalletWindowBlockedError',
  'WalletConnectionError',
])

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

  const endpoint = useMemo(() => HELIUS_CONFIG.RPC_URL, [])

  const onError = useCallback((error: WalletError) => {
    if (BENIGN_WALLET_ERRORS.has(error?.name)) {
      debugWarn('[wallet] benign event:', error.name, error.message)
      return
    }
    console.error('[wallet] error:', error)
  }, [])

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network }),
    ],
    [network]
  )

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect onError={onError}>
        <WalletModalProvider>
          <ToastProvider>{children}</ToastProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useState, ReactNode } from 'react'
import { makeQueryClient } from '@/lib/query/client'
import { ToastProvider } from '@/components/ui'

// Set in the Privy dashboard (dashboard.privy.io). REQUIRED: Privy rejects anything
// that isn't a 25-char app id at construction, so the build/app fails fast without it.
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ''

export function Providers({ children }: { children: ReactNode }) {
  // One query client per browser session; never shared across server requests.
  const [queryClient] = useState(() => makeQueryClient())

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email'],
        appearance: { walletChainType: 'solana-only' },
        embeddedWallets: {
          // Auto-create a Solana embedded wallet for every user on login.
          solana: { createOnLogin: 'all-users' },
          // Demo: sign without a per-action confirmation modal so a multi-tx flow
          // (capsule creation) runs popup-free. Flip to true to require confirmations.
          showWalletUIs: false,
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </PrivyProvider>
  )
}

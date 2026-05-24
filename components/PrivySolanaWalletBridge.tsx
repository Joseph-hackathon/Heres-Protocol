'use client'

import { useEffect, useRef } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useStandardWallets } from '@privy-io/react-auth/solana'
import { useWallet } from '@solana/wallet-adapter-react'
import type { WalletName } from '@solana/wallet-adapter-base'
import { registerWallet } from '@wallet-standard/wallet'

const PRIVY_SOLANA_WALLET_NAME = 'Privy'

export function PrivySolanaWalletRegistrar() {
  const { wallets } = useStandardWallets()
  const registeredWallets = useRef<WeakSet<object>>(new WeakSet())

  useEffect(() => {
    wallets.forEach((wallet) => {
      const walletObject = wallet as unknown as object
      if (registeredWallets.current.has(walletObject)) return
      registerWallet(wallet)
      registeredWallets.current.add(walletObject)
    })
  }, [wallets])

  return null
}

export function PrivySolanaWalletAutoConnect() {
  const { ready, authenticated } = usePrivy()
  const { wallets, wallet, select, connect, connected, connecting } = useWallet()
  const selectedName = wallet?.adapter.name
  const privyWalletName = wallets.find((entry) => entry.adapter.name === PRIVY_SOLANA_WALLET_NAME)?.adapter.name

  useEffect(() => {
    if (!ready || !authenticated || !privyWalletName) return
    if (selectedName === privyWalletName) return
    select(privyWalletName as WalletName)
  }, [authenticated, privyWalletName, ready, select, selectedName])

  useEffect(() => {
    if (!ready || !authenticated || !privyWalletName || connected || connecting) return
    if (selectedName !== privyWalletName) return
    connect().catch((error) => {
      console.warn('Privy Solana wallet auto-connect failed:', error)
    })
  }, [authenticated, connect, connected, connecting, privyWalletName, ready, selectedName])

  return null
}

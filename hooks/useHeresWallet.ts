'use client'

import { useMemo } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useWallets, useSignTransaction, useSignMessage } from '@privy-io/react-auth/solana'
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import type { HeresWallet } from '@/types/wallet'

// Demo behavior: suppress Privy's per-signature confirmation modal so a flow that
// signs several transactions (capsule creation signs 3+) runs without popups. The
// PrivyProvider sets the same default via embeddedWallets.showWalletUIs; both are
// flipped to `true` to restore an explicit confirmation on every signature.
const SHOW_WALLET_UIS = false

/**
 * Privy-backed implementation of the app's `HeresWallet` contract.
 *
 * Embedded-only: `useWallets()` returns the user's Privy embedded Solana wallet.
 * The app builds @solana/web3.js `Transaction`s and broadcasts them to its own RPC
 * connections (base layer + MagicBlock ER + TEE), so this shim only needs to SIGN:
 * it serializes a Transaction to the raw wire bytes Privy expects, then deserializes
 * the signed bytes back into a Transaction for the existing send paths in lib/solana.ts.
 */
export function useHeresWallet(): HeresWallet {
  const { ready, authenticated } = usePrivy()
  const { wallets } = useWallets()
  const { signTransaction: privySignTransaction } = useSignTransaction()
  const { signMessage: privySignMessage } = useSignMessage()

  // Embedded-only config => the Privy wallet is the only entry, but prefer it explicitly.
  const embedded = useMemo(
    () => wallets.find((w) => w.standardWallet?.name === 'Privy') ?? wallets[0],
    [wallets]
  )

  const publicKey = useMemo(
    () => (embedded ? new PublicKey(embedded.address) : null),
    [embedded]
  )

  const connected = ready && authenticated && !!embedded

  return useMemo<HeresWallet>(() => {
    if (!embedded || !publicKey) {
      return { publicKey: null, connected: false }
    }

    const signTransaction = async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      const isVersioned = tx instanceof VersionedTransaction
      const bytes = isVersioned
        ? tx.serialize()
        : (tx as Transaction).serialize({ requireAllSignatures: false, verifySignatures: false })

      const { signedTransaction } = await privySignTransaction({
        transaction: new Uint8Array(bytes),
        wallet: embedded,
        options: { uiOptions: { showWalletUIs: SHOW_WALLET_UIS } },
      })

      const signed = isVersioned
        ? VersionedTransaction.deserialize(signedTransaction)
        : Transaction.from(signedTransaction)
      return signed as T
    }

    // Privy signs each tx without a popup (showWalletUIs:false), so signing
    // sequentially has no UX cost and avoids the batch-overload typing.
    const signAllTransactions = async <T extends Transaction | VersionedTransaction>(
      txs: T[]
    ): Promise<T[]> => {
      const signed: T[] = []
      for (const tx of txs) signed.push(await signTransaction(tx))
      return signed
    }

    // Raw Ed25519 over the exact message bytes (no offchain prefix), which the
    // MagicBlock TEE `getAuthToken` flow and the CRE/admin auth headers rely on.
    const signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
      const { signature } = await privySignMessage({
        message,
        wallet: embedded,
        options: { uiOptions: { showWalletUIs: SHOW_WALLET_UIS } },
      })
      return signature
    }

    return { publicKey, connected: true, signTransaction, signAllTransactions, signMessage }
  }, [embedded, publicKey, privySignTransaction, privySignMessage])
}

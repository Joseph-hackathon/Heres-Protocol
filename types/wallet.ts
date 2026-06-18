import type { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'

/**
 * The wallet contract the Heres app depends on.
 *
 * This is the subset of the old @solana/wallet-adapter `WalletContextState` that
 * the app actually consumed. It is satisfied at runtime by the Privy-backed
 * `useHeresWallet()` shim. Keeping the contract in one place means lib/solana.ts
 * and lib/tee.ts only needed a type swap (not a rewrite) during the Privy
 * migration, and any future wallet backend just has to produce this shape.
 *
 * The signing methods are optional because they are only available once a wallet
 * is connected; callers guard on `connected` / `publicKey` before using them.
 */
export interface HeresWallet {
  publicKey: PublicKey | null
  connected: boolean
  signTransaction?: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>
  signAllTransactions?: <T extends Transaction | VersionedTransaction>(transactions: T[]) => Promise<T[]>
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>
}

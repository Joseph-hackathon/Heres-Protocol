/**
 * Type definitions for Heres project
 */

import { PublicKey } from '@solana/web3.js'
import { SupportedAssetSymbol } from '@/lib/assets'

// Beneficiary types (UI input model). The lean on-chain program stores only Solana pubkeys with
// proportional share_bps; EVM/CCIP + fixed-amount are UI-only and disabled until they return.
export interface Beneficiary {
  chain: 'solana' | 'evm'
  address: string
  amount: string
  amountType: 'fixed' | 'percentage'
  destinationChainSelector?: string
}

/** On-chain lean beneficiary: a Solana pubkey and its share of every distributed asset, in basis points. */
export interface OnChainBeneficiary {
  pubkey: PublicKey
  shareBps: number
}

// Intent Capsule (lean program layout). No intent_data / single mint: beneficiaries are first-class
// on-chain (set via update_intent), the vault holds SOL + any number of SPL token accounts, and the
// encrypted human "intent statement" lives off-chain (CRE), decoupled from the chain.
export interface IntentCapsule {
  owner: PublicKey
  inactivityPeriod: number
  lastActivity: number
  isActive: boolean
  executedAt: number | null
  bump?: number
  vaultBump?: number
  heartbeatAuthority?: PublicKey
  beneficiaries: OnChainBeneficiary[]
  /** Runtime owner of the account (program vs delegation program) - tells delegated vs settled-on-base. */
  accountOwner?: PublicKey
}

export interface CreIntentConfig {
  enabled: boolean
  secretRef: string
  secretHash: string
  recipientEmailHash: string
  recipientPhone?: string
  deliveryChannel?: 'email' | 'sms'
  paymentTx?: string
}

export interface CapsuleAssetMetadata {
  assetSymbol?: SupportedAssetSymbol
  assetMint?: string | null
}

// Wallet Activity types
export interface WalletActivity {
  wallet: string
  lastSignature: string
  lastActivityTimestamp: number
  transactionCount: number
}

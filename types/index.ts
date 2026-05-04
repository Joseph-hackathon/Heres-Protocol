/**
 * Type definitions for Heres project
 */

import { PublicKey } from '@solana/web3.js'
import { SupportedAssetSymbol } from '@/lib/assets'

// Beneficiary types
export interface Beneficiary {
  chain: 'solana' | 'evm'
  address: string
  amount: string
  amountType: 'fixed' | 'percentage'
  destinationChainSelector?: string
}

// Intent Capsule types
export interface IntentCapsule {
  owner: PublicKey
  inactivityPeriod: number
  lastActivity: number
  intentData: Uint8Array
  isActive: boolean
  executedAt: number | null
  accountOwner?: PublicKey
  mint?: PublicKey
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

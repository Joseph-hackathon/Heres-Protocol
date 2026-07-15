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
  /** Per-entry reserved pad (future cross-chain heir field). Optional in the app; zero-filled on write. */
  reserved?: number[]
}

/** Private per-NFT inheritance route stored in the TEE-resident BeneficiarySet. */
export interface OnChainNftAssignment {
  mint: PublicKey
  recipient: PublicKey
}

/**
 * The private beneficiary list (Workstream A: split out of the Switch into its own TEE-resident
 * account). Set/edited via update_intent routed to the TEE; revealed to base before distribution.
 */
export interface BeneficiarySet {
  owner: PublicKey
  version?: number
  isSealed?: boolean
  beneficiaries: OnChainBeneficiary[]
  nftAssignments: OnChainNftAssignment[]
}

// Intent Capsule (lean program layout). The "Switch" carries dead-man's-switch LIVENESS only; the
// private beneficiary list lives in a separate BeneficiarySet account (TEE). `beneficiaries` here is
// a view-model field the read path (getCapsule) populates from a BeneficiarySet read - it is [] when
// no set read happened or the TEE filtered it (no auth token). The vault holds SOL + any number of
// SPL token accounts; the encrypted human "intent statement" lives off-chain (CRE).
export interface IntentCapsule {
  owner: PublicKey
  inactivityPeriod: number
  lastActivity: number
  isActive: boolean
  executedAt: number | null
  bump?: number
  vaultBump?: number
  beneficiariesBump?: number
  heartbeatAuthority?: PublicKey
  version?: number
  /** True when the TEE settlement configuration is immutable for this lifecycle. */
  inheritanceSealed?: boolean
  /** Runtime delegation state of the separate BeneficiarySet account. */
  inheritanceDelegated?: boolean
  /** Absolute unix ts (seconds) the switch fires regardless of activity; null = inactivity-only. */
  targetDate?: number | null
  /** Populated from a BeneficiarySet read (TEE w/ token, or base post-reveal); [] otherwise. */
  beneficiaries: OnChainBeneficiary[]
  /** Populated from the same private BeneficiarySet read as `beneficiaries`. */
  nftAssignments?: OnChainNftAssignment[]
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

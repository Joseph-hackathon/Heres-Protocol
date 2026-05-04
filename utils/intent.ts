/**
 * Intent data encoding/decoding utilities
 */

import { Beneficiary } from '@/types'
import { SupportedAssetSymbol } from '@/lib/assets'

export interface CreIntentData {
  enabled: boolean
  secretRef: string
  secretHash: string
  recipientEmailHash: string
  recipientPhone?: string
  deliveryChannel?: 'email' | 'sms'
  paymentTx?: string
}

export interface IntentData {
  intent: string
  beneficiaries: Beneficiary[]
  totalAmount?: string
  assetSymbol?: SupportedAssetSymbol
  assetMint?: string | null
  inactivityDays: number
  inactivityValue?: number
  inactivityUnit?: 'days' | 'minutes'
  delayDays: number
  cre?: CreIntentData
  // Legacy payload field for backward compatibility with already-created capsules.
  premium?: CreIntentData
}

export interface NftIntentData {
  type: 'nft'
  intent: string
  nftMints: string[]
  nftRecipients: string[]
  nftAssignments?: Record<string, number>
  assetSymbol?: SupportedAssetSymbol
  assetMint?: string | null
  inactivityDays: number
  inactivityValue?: number
  inactivityUnit?: 'days' | 'minutes'
  delayDays: number
  cre?: CreIntentData
  // Legacy payload field for backward compatibility with already-created capsules.
  premium?: CreIntentData
}

export type AnyIntentData = IntentData | NftIntentData

/**
 * Encode intent data to Uint8Array
 */
export function encodeIntentData(data: IntentData): Uint8Array {
  const json = JSON.stringify(data)
  return new TextEncoder().encode(json)
}

/**
 * Decode intent data from Uint8Array
 */
export function decodeIntentData(data: Uint8Array): IntentData | null {
  try {
    const json = new TextDecoder().decode(data)
    return JSON.parse(json) as IntentData
  } catch (error) {
    console.error('Error decoding intent data:', error)
    return null
  }
}

export function parseIntentPayload(data: Uint8Array): AnyIntentData | null {
  try {
    const json = new TextDecoder().decode(data)
    return JSON.parse(json) as AnyIntentData
  } catch (error) {
    console.error('Error parsing intent payload:', error)
    return null
  }
}

/**
 * Convert days to seconds
 */
export function daysToSeconds(days: number): number {
  return days * 24 * 60 * 60
}

/**
 * Convert seconds to days
 */
export function secondsToDays(seconds: number): number {
  return seconds / (24 * 60 * 60)
}

export function formatDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
  return `${Math.round(seconds / 86400)}d`
}

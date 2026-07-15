/**
 * Centralized Zod validation schemas - the single source of truth for input shape + bounds across
 * the app. The SAME schemas run on the client (block bad input before a wallet signature / fetch)
 * and on the server (re-validate every request body, since the client is untrusted).
 *
 * Low-level format checks delegate to the existing primitives so there is one definition of "valid
 * Solana address" / "valid amount string" everywhere:
 *   - isValidSolanaAddress  (config/solana.ts)  - try/catch new PublicKey()
 *   - isValidAmountString   (lib/assets.ts)     - mirrors the on-chain amount parser (audit M1)
 */
import { z } from 'zod'
import { isValidSolanaAddress } from '@/config/solana'
import { isValidAmountString } from '@/lib/assets'
import { MAX_FUNGIBLE_ASSETS, parseDecimalToBaseUnits } from '@/lib/fungible-assets'

// ---- shared bounds ----
export const MAX_BENEFICIARIES = 8
export const MAX_NFT_ASSIGNMENTS = 8
export const MAX_INTENT_LENGTH = 20_000
// Cap free-form strings that get stored / rendered into emails so a single request cannot bloat the
// store or smuggle a huge payload into a template.
export const MAX_LABEL_LENGTH = 120
export const MAX_SYMBOL_LENGTH = 32
// Sanity ceiling on the inactivity window. The on-chain switch fires on inactivity OR an absolute
// date; 100 years is far longer than any real dead-man's-switch and keeps the derived seconds well
// inside i64, so a fat-fingered "999999 years" cannot overflow the BN before the chain rejects it.
export const MAX_INACTIVITY_DAYS = 100 * 365

export type InactivityUnit = 'minutes' | 'days' | 'months' | 'years'
const INACTIVITY_DAYS_PER_UNIT: Record<InactivityUnit, number> = {
  minutes: 1 / 1440,
  days: 1,
  months: 30,
  years: 365,
}

// ---- primitives ----

/** A required, trimmed base58 Solana address that PublicKey can parse. */
export const solanaAddress = z
  .string()
  .trim()
  .min(1, { message: 'Address is required.' })
  .refine(isValidSolanaAddress, { message: 'Not a valid Solana address.' })

/** A positive decimal amount as a string, in the exact format the on-chain parser accepts. */
export const decimalAmountString = z
  .string()
  .trim()
  .min(1, { message: 'Amount is required.' })
  .refine(isValidAmountString, { message: 'Use digits only, e.g. 1.5 (no signs, spaces, or exponent).' })
  .refine((s) => parseFloat(s) > 0, { message: 'Amount must be greater than zero.' })

/** RFC-ish email, length-capped (254 = max per RFC 5321). */
export const emailString = z
  .email({ message: 'Enter a valid email address.' })
  .max(254, { message: 'Email address is too long.' })

/** Human intent statement: non-empty, capped to the same limit the server enforces. */
export const intentMessage = z
  .string()
  .trim()
  .min(1, { message: 'Write an intent statement.' })
  .max(MAX_INTENT_LENGTH, { message: `Keep the intent statement under ${MAX_INTENT_LENGTH} characters.` })

/** A beneficiary's percentage share as a string: a number in (0, 100]. */
export const sharePctString = z
  .string()
  .trim()
  .min(1, { message: 'Share is required.' })
  .refine(isValidAmountString, { message: 'Share must be a number, e.g. 25.' })
  .refine((s) => {
    const n = parseFloat(s)
    return n > 0 && n <= 100
  }, { message: 'Share must be greater than 0 and at most 100.' })

/** A positive whole-number count entered as a string or number (rejects "1.9", "-3", "abc"). */
export const positiveInt = z.coerce
  .number({ message: 'Enter a number.' })
  .int({ message: 'Use a whole number.' })
  .positive({ message: 'Must be greater than zero.' })

/** A non-negative integer (for counts / day deltas in metadata). */
export const nonNegativeInt = z.coerce
  .number({ message: 'Enter a number.' })
  .int({ message: 'Use a whole number.' })
  .min(0, { message: 'Cannot be negative.' })

/** A unix-ms timestamp: a finite positive integer. */
export const unixMillis = z
  .number({ message: 'Timestamp is required.' })
  .int({ message: 'Timestamp must be an integer.' })
  .positive({ message: 'Timestamp must be positive.' })

/** A required non-empty signature string. */
export const signatureString = z.string().min(1, { message: 'Signature is required.' })

// ---- beneficiary list (shared by the create wizard + Edit Beneficiaries) ----

export interface BeneficiaryInput {
  address: string
  /** Percentage share as a string, e.g. "25" or "33.33". */
  share: string
}

/**
 * Validate a beneficiary list: 1..MAX rows, each a valid address + share, shares total exactly 100%
 * (checked as basis points so it matches the on-chain `share_bps` sum of 10000), no duplicate
 * addresses, and - when an owner address is supplied - no self-as-beneficiary.
 *
 * Per-row issues use path [index, 'address' | 'share']; the cross-row total uses path ['_shares'].
 */
export function beneficiariesSchema(opts?: { ownerAddress?: string }) {
  return z
    .array(z.object({ address: solanaAddress, share: sharePctString }))
    .min(1, { message: 'Add at least one beneficiary.' })
    .max(MAX_BENEFICIARIES, { message: `No more than ${MAX_BENEFICIARIES} beneficiaries.` })
    .superRefine((rows, ctx) => {
      // Shares must total exactly 100% once rounded to basis points (what the program requires).
      const totalBps = rows.reduce((sum, r) => {
        const n = parseFloat(r.share || '0')
        return sum + (Number.isFinite(n) ? Math.round(n * 100) : 0)
      }, 0)
      if (totalBps !== 10000) {
        ctx.addIssue({
          code: 'custom',
          path: ['_shares'],
          message: `Shares must total exactly 100% (currently ${(totalBps / 100).toFixed(2)}%).`,
        })
      }
      // Duplicate + self checks run only on rows whose address already parses, so we do not stack a
      // second error on a row that is already flagged as an invalid address.
      const seen = new Set<string>()
      const owner = opts?.ownerAddress?.trim()
      rows.forEach((r, i) => {
        const addr = r.address.trim()
        if (!isValidSolanaAddress(addr)) return
        if (owner && addr === owner) {
          ctx.addIssue({ code: 'custom', path: [i, 'address'], message: 'You cannot list your own wallet as a beneficiary.' })
        }
        if (seen.has(addr)) {
          ctx.addIssue({ code: 'custom', path: [i, 'address'], message: 'Duplicate beneficiary address.' })
        } else {
          seen.add(addr)
        }
      })
    })
}

export interface NftAssignmentInput {
  mint: string
  recipient: string
}

/** Validate one explicit recipient per NFT mint. A recipient may inherit multiple NFTs. */
export function nftAssignmentsSchema(opts?: { ownerAddress?: string }) {
  return z
    .array(z.object({ mint: solanaAddress, recipient: solanaAddress }))
    .min(1, { message: 'Select at least one NFT.' })
    .max(MAX_NFT_ASSIGNMENTS, { message: `No more than ${MAX_NFT_ASSIGNMENTS} NFTs per capsule.` })
    .superRefine((rows, ctx) => {
      const seenMints = new Set<string>()
      const owner = opts?.ownerAddress?.trim()
      rows.forEach((row, index) => {
        const mint = row.mint.trim()
        const recipient = row.recipient.trim()
        if (isValidSolanaAddress(mint)) {
          if (seenMints.has(mint)) {
            ctx.addIssue({ code: 'custom', path: [index, 'mint'], message: 'Duplicate NFT mint.' })
          }
          seenMints.add(mint)
        }
        if (owner && recipient === owner) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'recipient'],
            message: 'You cannot assign an NFT back to your own wallet.',
          })
        }
      })
    })
}

// ---- create-capsule wizard (client) ----

/**
 * The raw create-wizard inputs, validated together. `maxBalance` (when the asset is a detected SPL
 * token) enforces a wallet-balance ceiling; native SOL is left unbounded so the user can keep gas.
 * `allowMinutes` reflects the devnet-only minute mode.
 */
export function createCapsuleInputSchema(opts: {
  ownerAddress?: string
  maxBalance?: number | null
  allowMinutes?: boolean
}) {
  const amount =
    opts.maxBalance != null
      ? decimalAmountString.refine((s) => parseFloat(s) <= opts.maxBalance!, {
          message: `Amount exceeds your wallet balance of ${opts.maxBalance}.`,
        })
      : decimalAmountString

  return z
    .object({
      totalAmount: amount,
      inactivityValue: positiveInt,
      inactivityUnit: z.enum(['minutes', 'days', 'months', 'years']),
      // Optional absolute fire date as YYYY-MM-DD; '' means inactivity-only.
      targetDate: z.string().trim().optional().default(''),
      intent: intentMessage,
      intentEmail: emailString,
      beneficiaries: beneficiariesSchema({ ownerAddress: opts.ownerAddress }),
    })
    .superRefine((val, ctx) => {
      const days = val.inactivityValue * INACTIVITY_DAYS_PER_UNIT[val.inactivityUnit]
      if (days > MAX_INACTIVITY_DAYS) {
        ctx.addIssue({ code: 'custom', path: ['inactivityValue'], message: 'Inactivity period is too long (max 100 years).' })
      }
      if (val.inactivityUnit === 'minutes' && !opts.allowMinutes) {
        ctx.addIssue({ code: 'custom', path: ['inactivityUnit'], message: 'Minute mode is not available on this network.' })
      }
      if (val.targetDate) {
        const ts = Math.floor(new Date(val.targetDate + 'T00:00:00').getTime() / 1000)
        if (!Number.isFinite(ts)) {
          ctx.addIssue({ code: 'custom', path: ['targetDate'], message: 'Enter a valid date, or leave it blank.' })
        } else if (ts <= Math.floor(Date.now() / 1000)) {
          ctx.addIssue({ code: 'custom', path: ['targetDate'], message: 'The fixed fire date must be in the future.' })
        }
      }
    })
}

/** Multi-mint create flow. The beneficiary split applies identically to every selected asset. */
export function createMultiAssetCapsuleInputSchema(opts: {
  ownerAddress?: string
  assets: Record<string, { decimals: number; maxBalance?: number | null; maxBaseUnits?: bigint | null }>
  allowMinutes?: boolean
}) {
  return z
    .object({
      assets: z
        .array(z.object({
          assetKey: z.string().trim().min(1, { message: 'Choose an asset.' }).max(64),
          amount: decimalAmountString,
        }))
        .min(1, { message: 'Select at least one asset.' })
        .max(MAX_FUNGIBLE_ASSETS, {
          message: `No more than ${MAX_FUNGIBLE_ASSETS} fungible assets per capsule.`,
        }),
      inactivityValue: positiveInt,
      inactivityUnit: z.enum(['minutes', 'days', 'months', 'years']),
      targetDate: z.string().trim().optional().default(''),
      intent: intentMessage,
      intentEmail: emailString,
      beneficiaries: beneficiariesSchema({ ownerAddress: opts.ownerAddress }),
    })
    .superRefine((val, ctx) => {
      const seen = new Set<string>()
      val.assets.forEach((asset, index) => {
        if (seen.has(asset.assetKey)) {
          ctx.addIssue({ code: 'custom', path: ['assets', index, 'assetKey'], message: 'Asset selected more than once.' })
        }
        seen.add(asset.assetKey)

        const config = opts.assets[asset.assetKey]
        if (!config) {
          ctx.addIssue({ code: 'custom', path: ['assets', index, 'assetKey'], message: 'This asset is no longer available.' })
          return
        }
        const units = parseDecimalToBaseUnits(asset.amount, config.decimals)
        if (units == null) {
          ctx.addIssue({
            code: 'custom',
            path: ['assets', index, 'amount'],
            message: `Use no more than ${config.decimals} decimal places.`,
          })
        } else if (config.maxBaseUnits != null && units > config.maxBaseUnits) {
          ctx.addIssue({
            code: 'custom',
            path: ['assets', index, 'amount'],
            message: config.maxBalance == null
              ? 'Amount exceeds your wallet balance.'
              : `Amount exceeds your wallet balance of ${config.maxBalance}.`,
          })
        }
      })

      const days = val.inactivityValue * INACTIVITY_DAYS_PER_UNIT[val.inactivityUnit]
      if (days > MAX_INACTIVITY_DAYS) {
        ctx.addIssue({ code: 'custom', path: ['inactivityValue'], message: 'Inactivity period is too long (max 100 years).' })
      }
      if (val.inactivityUnit === 'minutes' && !opts.allowMinutes) {
        ctx.addIssue({ code: 'custom', path: ['inactivityUnit'], message: 'Minute mode is not available on this network.' })
      }
      if (val.targetDate) {
        const ts = Math.floor(new Date(val.targetDate + 'T00:00:00').getTime() / 1000)
        if (!Number.isFinite(ts)) {
          ctx.addIssue({ code: 'custom', path: ['targetDate'], message: 'Enter a valid date, or leave it blank.' })
        } else if (ts <= Math.floor(Date.now() / 1000)) {
          ctx.addIssue({ code: 'custom', path: ['targetDate'], message: 'The fixed fire date must be in the future.' })
        }
      }
    })
}

/** NFT create flow: explicit mint-to-recipient routes replace fungible amount/share inputs. */
export function createNftCapsuleInputSchema(opts: {
  ownerAddress?: string
  allowMinutes?: boolean
}) {
  return z
    .object({
      inactivityValue: positiveInt,
      inactivityUnit: z.enum(['minutes', 'days', 'months', 'years']),
      targetDate: z.string().trim().optional().default(''),
      intent: intentMessage,
      intentEmail: emailString,
      assignments: nftAssignmentsSchema({ ownerAddress: opts.ownerAddress }),
    })
    .superRefine((val, ctx) => {
      const days = val.inactivityValue * INACTIVITY_DAYS_PER_UNIT[val.inactivityUnit]
      if (days > MAX_INACTIVITY_DAYS) {
        ctx.addIssue({ code: 'custom', path: ['inactivityValue'], message: 'Inactivity period is too long (max 100 years).' })
      }
      if (val.inactivityUnit === 'minutes' && !opts.allowMinutes) {
        ctx.addIssue({ code: 'custom', path: ['inactivityUnit'], message: 'Minute mode is not available on this network.' })
      }
      if (val.targetDate) {
        const ts = Math.floor(new Date(val.targetDate + 'T00:00:00').getTime() / 1000)
        if (!Number.isFinite(ts)) {
          ctx.addIssue({ code: 'custom', path: ['targetDate'], message: 'Enter a valid date, or leave it blank.' })
        } else if (ts <= Math.floor(Date.now() / 1000)) {
          ctx.addIssue({ code: 'custom', path: ['targetDate'], message: 'The fixed fire date must be in the future.' })
        }
      }
    })
}

// ---- server request-body schemas ----

/** POST /api/intent-delivery/register */
export const intentRegisterBody = z.object({
  owner: solanaAddress,
  recipientEmail: emailString,
  message: intentMessage,
  timestamp: unixMillis,
  signature: signatureString,
})

/**
 * POST /api/intent-reminder/register. Required: capsuleAddress, owner, recipientEmail,
 * beneficiaryCount, delayDays, timestamp, signature. The display-only metadata fields are optional
 * (the route applies its own defaults) but still length-capped so they cannot bloat the store or be
 * smuggled into the reminder email template.
 */
export const intentReminderBody = z.object({
  capsuleAddress: solanaAddress,
  owner: solanaAddress,
  recipientEmail: emailString,
  assetSymbol: z.string().trim().max(MAX_SYMBOL_LENGTH, { message: 'Asset symbol is too long.' }).optional(),
  assetLabel: z.string().trim().max(MAX_LABEL_LENGTH, { message: 'Asset label is too long.' }).optional(),
  assetMint: solanaAddress.nullish(),
  assetDecimals: nonNegativeInt.max(18, { message: 'Invalid decimals.' }).optional(),
  totalAmount: z.string().trim().max(64, { message: 'Amount is too long.' }).optional(),
  beneficiaryCount: nonNegativeInt.max(MAX_BENEFICIARIES, { message: 'Too many beneficiaries.' }),
  inactivityLabel: z.string().trim().max(MAX_LABEL_LENGTH, { message: 'Inactivity label is too long.' }).optional(),
  delayDays: nonNegativeInt.max(365, { message: 'Delay is too long.' }),
  createdAt: unixMillis.optional(),
  timestamp: unixMillis,
  signature: signatureString,
})

/** POST /api/mobile/tx/create-capsule */
export const mobileCreateCapsuleBody = z
  .object({
    owner: solanaAddress,
    totalSol: decimalAmountString,
    inactivityDays: positiveInt.refine((n) => n <= MAX_INACTIVITY_DAYS, { message: 'Inactivity period is too long (max 100 years).' }),
    beneficiaryAddress: solanaAddress,
    beneficiaryAmountSol: decimalAmountString,
    intent: intentMessage.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.beneficiaryAddress === val.owner) {
      ctx.addIssue({ code: 'custom', path: ['beneficiaryAddress'], message: 'You cannot list your own wallet as a beneficiary.' })
    }
  })

/** Bodies that carry only an owner / wallet / capsule address. */
export const ownerBody = z.object({ owner: solanaAddress })
export const walletBody = z.object({ wallet: solanaAddress })
export const capsuleAddressBody = z.object({ capsuleAddress: solanaAddress })

// ---- helpers ----

/**
 * Map a ZodError to a flat { "path.to.field": "first message" } record for wiring into Field.error.
 * Cross-field issues land under their synthetic path (e.g. "beneficiaries._shares"). First issue per
 * key wins so a field shows one message at a time.
 */
export function collectFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_form'
    if (!(key in out)) out[key] = issue.message
  }
  return out
}

/** First human-readable issue message, for a server 400 response. */
export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid request.'
}

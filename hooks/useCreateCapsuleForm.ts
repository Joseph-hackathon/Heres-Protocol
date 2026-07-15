'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useHeresWallet } from '@/hooks/useHeresWallet'
import { useToast } from '@/components/ui'
import { maskAddress } from '@/lib/format'
import { normalizeTxError } from '@/lib/errors'
import {
  createDelegatedCapsule,
  getCapsule,
  getCapsuleAccountLocations,
  registerCapsuleOwnerForAutomation,
} from '@/lib/solana'
import { getCapsulePDA } from '@/lib/program'
import { Beneficiary, OnChainNftAssignment } from '@/types'
import {
  DEFAULT_VALUES,
  STORAGE_KEYS,
  SOLANA_CONFIG,
  MAX_CAPSULE_MODIFICATIONS,
} from '@/constants'
import { daysToSeconds } from '@/utils/intent'
import { getVaultTokenAccounts } from '@/lib/spl'
import { buildIntentSignedMessage } from '@/utils/intentAuth'
import { bytesToBase64, sha256Hex } from '@/utils/intentClient'
import { isValidEmail } from '@/utils/validation'
import {
  createMultiAssetCapsuleInputSchema,
  createNftCapsuleInputSchema,
  collectFieldErrors,
  firstError,
  MAX_NFT_ASSIGNMENTS,
} from '@/lib/schemas'
import { getSolanaConnection, isValidSolanaAddress } from '@/config/solana'
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import { queryKeys } from '@/lib/query/keys'
import { hasExistingCapsuleAccounts } from '@/lib/capsule-lifecycle'
import { useSolBalance } from '@/hooks/queries/useSolBalance'
import {
  MAX_FUNGIBLE_ASSETS,
  SOL_ASSET_KEY,
  parseDecimalToBaseUnits,
  spendableSolLamports,
  type SelectedFungibleAsset,
  type WalletFungibleAsset,
} from '@/lib/fungible-assets'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

export type CapsuleAssetType = 'token' | 'nft' | null
export type InactivityUnit = 'minutes' | 'days' | 'months' | 'years'

// Inactivity unit metadata. Months/years use fixed lengths (30d / 365d) - this is an
// inactivity countdown, not a calendar reminder, so approximate spans are fine.
const INACTIVITY_DAYS_PER_UNIT: Record<Exclude<InactivityUnit, 'minutes'>, number> = {
  days: 1,
  months: 30,
  years: 365,
}
const INACTIVITY_PRESETS: Record<InactivityUnit, { label: string; value: number }[]> = {
  minutes: [
    { label: '1min', value: 1 },
    { label: '5min', value: 5 },
    { label: '10min', value: 10 },
  ],
  days: [
    { label: '30d', value: 30 },
    { label: '90d', value: 90 },
    { label: '180d', value: 180 },
  ],
  months: [
    { label: '3mo', value: 3 },
    { label: '6mo', value: 6 },
    { label: '12mo', value: 12 },
  ],
  years: [
    { label: '1y', value: 1 },
    { label: '2y', value: 2 },
    { label: '5y', value: 5 },
  ],
}
const INACTIVITY_PLACEHOLDER: Record<InactivityUnit, string> = {
  minutes: 'e.g. 5',
  days: 'e.g. 90',
  months: 'e.g. 6',
  years: 'e.g. 1',
}
const inactivityUnitToSeconds = (value: number, unit: InactivityUnit): number =>
  unit === 'minutes' ? value * 60 : daysToSeconds(value * INACTIVITY_DAYS_PER_UNIT[unit])

export type NftItem = { mint: string; name?: string; symbol?: string; imageUri?: string }

// The lean program is Solana-only + proportional, so a UI beneficiary is just an address + a % share.
// A stable id keeps React keys correct across add/remove (index keys mis-associate inputs on removal).
type UiBeneficiary = Beneficiary & { id: string }

export const CREATE_STEPS = [
  { key: 'asset', label: 'Select Asset Type' },
  { key: 'beneficiary', label: 'Configure Beneficiaries' },
  { key: 'intent', label: 'Declare Your Intent' },
  { key: 'review', label: 'Review & Create' },
] as const

export const CREATE_FAQS = [
  {
    key: 'capsule',
    question: 'What Is a Capsule?',
    answer: 'A capsule is an on-chain instruction set that defines who receives your assets and under which inactivity conditions execution can happen.',
  },
  {
    key: 'intent',
    question: 'What Is Intent?',
    answer: 'Intent is the human-readable instruction attached to your capsule. It helps explain the purpose of the transfer and can be delivered securely to your representative.',
  },
  {
    key: 'count',
    question: 'How Many Capsules Can I Create at a time?',
    answer: 'One wallet manages one current capsule. After execution, finish distribution and intent delivery, then finalize it before creating another.',
  },
  {
    key: 'representative',
    question: 'What Is a Representative?',
    answer: 'A representative is the single email recipient who receives the encrypted intent package once execution is confirmed.',
  },
  {
    key: 'beneficiaries',
    question: 'Can I Change My Beneficiaries?',
    answer: 'You can update beneficiaries while you still have modification quota remaining and the capsule has not reached a terminal state.',
  },
] as const

// Split 100% evenly across n recipients; the last absorbs the rounding remainder so the displayed
// shares always total exactly 100 (and the derived share_bps total exactly 10000).
function evenShares(n: number): string[] {
  if (n <= 0) return []
  const base = Math.floor((10000 / n)) / 100 // 2dp floor of the per-head percentage
  const shares = Array(n).fill(base)
  shares[n - 1] = Math.round((100 - base * (n - 1)) * 100) / 100
  return shares.map((s) => String(s))
}

export function useCreateCapsuleForm() {
  const router = useRouter()
  const wallet = useHeresWallet()
  const { publicKey, connected } = wallet
  const { toast } = useToast()
  const [intent, setIntent] = useState('')
  const [capsuleType, setCapsuleType] = useState<CapsuleAssetType>(null)
  // A capsule vault can hold native SOL plus multiple classic SPL / Token-2022 mints. SOL starts
  // selected to preserve the simple default path; users can add or remove assets before creation.
  const [selectedAssetKeys, setSelectedAssetKeys] = useState<string[]>([SOL_ASSET_KEY])
  const [assetAmounts, setAssetAmounts] = useState<Record<string, string>>({ [SOL_ASSET_KEY]: '' })
  const beneficiaryIdRef = useRef(1)
  const [beneficiaries, setBeneficiaries] = useState<UiBeneficiary[]>([
    { id: 'b0', chain: 'solana', address: '', amount: '100', amountType: 'percentage', destinationChainSelector: '' }
  ])
  const [inactivityDays, setInactivityDays] = useState('')
  const [inactivityUnit, setInactivityUnit] = useState<InactivityUnit>('days')
  // Optional absolute fire date (YYYY-MM-DD). When set, the capsule ALSO fires on this date regardless
  // of activity - whichever trigger (inactivity or this date) comes first wins. Empty = inactivity-only.
  const [targetDate, setTargetDate] = useState('')
  // delayDays is reminder metadata only; settlement can begin as soon as the capsule fires.
  const delayDays = DEFAULT_VALUES.DELAY_DAYS
  const [showSimulation, setShowSimulation] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [currentStep, setCurrentStep] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Per-field validation messages, keyed by schema path (e.g. 'assets.0.amount', 'beneficiaries.0.address',
  // 'beneficiaries._shares'). Populated on submit; cleared the moment the user edits any input below.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [existingCapsule, setExistingCapsule] = useState<boolean>(false)
  const [existingCapsuleAddress, setExistingCapsuleAddress] = useState<string | null>(null)
  const [existingCapsuleCheck, setExistingCapsuleCheck] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [existingCapsuleCheckError, setExistingCapsuleCheckError] = useState<string | null>(null)
  const [existingCapsuleCheckAttempt, setExistingCapsuleCheckAttempt] = useState(0)
  const [modifyCount, setModifyCount] = useState<number>(0)
  const [openSection, setOpenSection] = useState<'asset' | 'beneficiaries' | 'intent' | 'review'>('asset')
  const [openFaq, setOpenFaq] = useState<string | null>(CREATE_FAQS[0].key)
  // NFT flow
  const [selectedNftMints, setSelectedNftMints] = useState<string[]>([])
  const [nftRecipients, setNftRecipients] = useState<{ address: string }[]>([{ address: '' }])
  const [nftAssignments, setNftAssignments] = useState<Record<string, number>>({})
  // Intent Statement email delivery (CRE)
  const [intentEmail, setIntentEmail] = useState('')
  const [intentReminderEnabled, setIntentReminderEnabled] = useState(true)

  // Drop submit-time field errors the moment the user edits any validated input, so a stale message
  // never lingers on a field they have already corrected (next submit re-validates from scratch).
  // Done in the change handlers (not an effect) to avoid cascading renders.
  const clearFieldErrors = () => setFieldErrors((prev) => (Object.keys(prev).length ? {} : prev))

  // Fetch wallet NFTs when NFT path is selected (Helius DAS when API key set, else RPC). The fetch
  // body is the exact existing Effect 1 logic, now keyed/cached by React Query.
  const nftQuery = useQuery({
    queryKey: queryKeys.wallet.nfts(publicKey?.toBase58() ?? ''),
    enabled: capsuleType === 'nft' && connected && !!publicKey,
    queryFn: async (): Promise<NftItem[]> => {
      const owner = publicKey!
      if (SOLANA_CONFIG.HELIUS_API_KEY) {
        const res = await fetch(`/api/helius/nfts?wallet=${encodeURIComponent(owner.toBase58())}`, {
          cache: 'no-store',
        })
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload) {
          throw new Error(payload?.error || `NFT request failed (${res.status})`)
        }
        const items = Array.isArray(payload.items) ? payload.items as Array<{ mint: string; name?: string; symbol?: string; imageUri?: string }> : []
        const nfts: NftItem[] = items.map((item) => ({
          mint: item.mint,
          name: item.name,
          symbol: item.symbol,
          imageUri: item.imageUri,
        }))
        return nfts
      }

      const connection = getSolanaConnection()
      const { value } = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })
      const nfts: NftItem[] = value
        .filter((acc) => {
          const info = acc.account?.data?.parsed?.info
          if (!info?.tokenAmount) return false
          const decimals = Number(info.tokenAmount.decimals)
          const amount = info.tokenAmount.amount ?? info.tokenAmount.uiAmount
          return decimals === 0 && (Number(amount) === 1 || amount === '1')
        })
        .map((acc) => {
          const info = acc.account?.data?.parsed?.info
          const mint = info?.mint ?? ''
          return { mint, name: undefined, symbol: undefined }
        })
      return nfts
    },
  })
  const nftList = nftQuery.data ?? []
  const nftListLoading = nftQuery.isFetching

  // Check for any existing lifecycle accounts before enabling the builder. A capsule remains the
  // wallet's current capsule after execution, so recreation must not be entered accidentally here.
  useEffect(() => {
    const checkExistingCapsule = async () => {
      if (!connected || !publicKey) {
        setExistingCapsule(false)
        setExistingCapsuleAddress(null)
        setExistingCapsuleCheck('idle')
        setExistingCapsuleCheckError(null)
        return
      }

      const countKey = STORAGE_KEYS.CAPSULE_MODIFY_COUNT(publicKey.toBase58())
      const stored = localStorage.getItem(countKey)
      setModifyCount(stored ? parseInt(stored, 10) || 0 : 0)
      setExistingCapsuleCheck('loading')
      setExistingCapsuleCheckError(null)

      try {
        const locations = await getCapsuleAccountLocations(publicKey)
        if (locations.switch !== 'missing') {
          setExistingCapsule(true)
          setExistingCapsuleAddress(locations.switchAddress)
        } else if (hasExistingCapsuleAccounts(locations)) {
          setExistingCapsule(false)
          setExistingCapsuleAddress(null)
          setExistingCapsuleCheckError(
            'Existing capsule data needs recovery before a new capsule can be created. Refresh once, then contact support if this message remains.'
          )
          setExistingCapsuleCheck('error')
          return
        } else {
          setExistingCapsule(false)
          setExistingCapsuleAddress(null)
        }
        setExistingCapsuleCheck('ready')
      } catch (err) {
        console.error('Error checking for existing capsule:', err)
        setExistingCapsule(false)
        setExistingCapsuleAddress(null)
        setExistingCapsuleCheckError(
          'Heres could not check this wallet for an existing capsule. Retry before creating.'
        )
        setExistingCapsuleCheck('error')
      }
    }
    checkExistingCapsule()
  }, [connected, publicKey, existingCapsuleCheckAttempt])

  // Add a recipient and re-split shares evenly so they always total 100% (1 -> 100, 2 -> 50/50, ...).
  const addBeneficiary = () => {
    clearFieldErrors()
    setBeneficiaries((prev) => {
      const next: UiBeneficiary[] = [
        ...prev,
        { id: `b${beneficiaryIdRef.current++}`, chain: 'solana', address: '', amount: '', amountType: 'percentage', destinationChainSelector: '' },
      ]
      const shares = evenShares(next.length)
      return next.map((b, i) => ({ ...b, amount: shares[i] }))
    })
  }

  // Reset all shares to an even split (the "Split evenly" affordance).
  const splitEvenly = () => {
    clearFieldErrors()
    setBeneficiaries((prev) => {
      const shares = evenShares(prev.length)
      return prev.map((b, i) => ({ ...b, amount: shares[i] }))
    })
  }

  const supportsMinuteMode = SOLANA_CONFIG.NETWORK === 'devnet'
  // Minutes is a devnet-only testing affordance; real users pick days/months/years.
  const inactivityUnitOptions: InactivityUnit[] = supportsMinuteMode
    ? ['days', 'months', 'years', 'minutes']
    : ['days', 'months', 'years']

  // Auto-detect the connected wallet's fungible tokens (both token programs) so the user can lock any
  // of them. NFTs (decimals 0, amount 1) and zero balances are filtered out. The fetch body is the
  // exact existing Effect 3 logic, now keyed/cached by React Query.
  const tokensQuery = useQuery({
    queryKey: queryKeys.wallet.tokens(publicKey?.toBase58() ?? ''),
    enabled: capsuleType === 'token' && connected && !!publicKey,
    queryFn: async (): Promise<WalletFungibleAsset[]> => {
      const accts = await getVaultTokenAccounts(getSolanaConnection(), publicKey!)
      const tokens: WalletFungibleAsset[] = accts
        .filter((t) => t.amount > 0n && !(t.decimals === 0 && t.amount === 1n))
        .map((t) => ({
          key: t.mint.toBase58(),
          mint: t.mint.toBase58(),
          decimals: t.decimals,
          symbol: maskAddress(t.mint.toBase58()),
          balanceUi: Number(t.amount) / Math.pow(10, t.decimals),
          balanceBaseUnits: t.amount,
          tokenProgram: t.tokenProgram.toBase58(),
        }))
        .sort((a, b) => b.balanceUi - a.balanceUi)
      return tokens
    },
  })
  const walletTokens = tokensQuery.data ?? []
  const tokensLoading = tokensQuery.isFetching
  const solBalance = useSolBalance(publicKey)
  const spendableSol = spendableSolLamports(solBalance.lamports)
  const solAsset: WalletFungibleAsset = {
    key: SOL_ASSET_KEY,
    mint: null,
    decimals: 9,
    symbol: 'SOL',
    balanceUi: spendableSol == null ? null : Number(spendableSol) / LAMPORTS_PER_SOL,
    balanceBaseUnits: spendableSol,
    tokenProgram: null,
  }
  const walletAssets = [solAsset, ...walletTokens]
  const selectedAssets: SelectedFungibleAsset[] = selectedAssetKeys
    .map((key) => walletAssets.find((asset) => asset.key === key))
    .filter((asset): asset is WalletFungibleAsset => Boolean(asset))
    .map((asset) => ({ ...asset, amount: assetAmounts[asset.key] ?? '' }))
  const assetUnit = selectedAssets.length === 1 ? selectedAssets[0]?.symbol ?? 'asset' : `${selectedAssets.length} assets`

  const toggleAssetSelection = (key: string) => {
    clearFieldErrors()
    setError(null)
    setSelectedAssetKeys((current) => {
      if (current.includes(key)) return current.filter((assetKey) => assetKey !== key)
      if (current.length >= MAX_FUNGIBLE_ASSETS) {
        setError(`You can lock up to ${MAX_FUNGIBLE_ASSETS} fungible assets in one capsule.`)
        return current
      }
      return [...current, key]
    })
    setAssetAmounts((current) => ({ ...current, [key]: current[key] ?? '' }))
  }

  const setAssetAmount = (key: string, amount: string) => {
    clearFieldErrors()
    setAssetAmounts((current) => ({ ...current, [key]: amount }))
  }

  const formatInactivityLabel = (value: string | number, unit: InactivityUnit) => {
    const numeric = typeof value === 'number' ? value : parseInt(value, 10)
    if (!Number.isFinite(numeric) || numeric <= 0) return ''
    const singular =
      unit === 'minutes' ? 'minute' : unit === 'days' ? 'day' : unit === 'months' ? 'month' : 'year'
    return `${numeric} ${singular}${numeric === 1 ? '' : 's'}`
  }

  // Approximate calendar date the switch would fire if the owner goes silent from today.
  // Shown for day/month/year spans; minutes are too short to be a meaningful date.
  const approxFireDate = (() => {
    const numeric = parseInt(inactivityDays, 10)
    if (inactivityUnit === 'minutes' || !Number.isFinite(numeric) || numeric <= 0) return ''
    const d = new Date()
    d.setDate(d.getDate() + numeric * INACTIVITY_DAYS_PER_UNIT[inactivityUnit])
    return d.toLocaleDateString()
  })()

  // Earliest selectable fixed fire date (tomorrow) for the optional target-date input. The contract
  // rejects a target_date that is not strictly in the future, so today is excluded.
  const minTargetDate = (() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  // Remove a recipient and re-split the remaining shares evenly.
  const removeBeneficiary = (index: number) => {
    clearFieldErrors()
    setBeneficiaries((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((_, i) => i !== index)
      const shares = evenShares(next.length)
      return next.map((b, i) => ({ ...b, amount: shares[i] }))
    })
  }

  const toggleNftSelection = (mint: string) => {
    clearFieldErrors()
    setSelectedNftMints((prev) => {
      if (prev.includes(mint)) {
        setNftAssignments((assignments) => {
          const next = { ...assignments }
          delete next[mint]
          return next
        })
        return prev.filter((m) => m !== mint)
      }
      if (prev.length >= MAX_NFT_ASSIGNMENTS) {
        setError(`You can lock up to ${MAX_NFT_ASSIGNMENTS} NFTs in one capsule.`)
        return prev
      }
      return [...prev, mint]
    })
  }

  const addNftRecipient = () => {
    setNftRecipients((prev) => [...prev, { address: '' }])
  }

  const removeNftRecipient = (index: number) => {
    if (nftRecipients.length > 1) {
      setNftRecipients((prev) => prev.filter((_, i) => i !== index))
      setNftAssignments((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([mint, assignedIndex]) => [
            mint,
            assignedIndex === index ? 0 : assignedIndex > index ? assignedIndex - 1 : assignedIndex,
          ])
        )
      )
    }
  }

  const setNftRecipientAddress = (index: number, address: string) => {
    setNftRecipients((prev) => {
      const next = [...prev]
      next[index] = { address }
      return next
    })
  }

  const setNftAssignment = (mint: string, recipientIndex: number) => {
    setNftAssignments((prev) => ({ ...prev, [mint]: recipientIndex }))
  }

  // Solana-only, percentage-only: update an address, or a share (clamped to <=100, raw kept so the
  // user can still type decimals). Shares are free to edit after the even-split default.
  const updateBeneficiary = (index: number, field: 'address' | 'amount', value: string) => {
    clearFieldErrors()
    setBeneficiaries((prev) => {
      const next = [...prev]
      if (field === 'amount') {
        const n = parseFloat(value)
        next[index] = { ...next[index], amount: Number.isFinite(n) && n > 100 ? '100' : value }
      } else {
        next[index] = { ...next[index], address: value }
      }
      return next
    })
  }

  const handleCreate = async () => {
    setError(null)
    if (!connected || !publicKey) {
      setError('Please connect your Solana wallet.')
      return
    }

    if (!capsuleType) {
      setError('Select an asset type before creating the capsule.')
      return
    }

    // Check modification limit (3 per wallet)
    const countKey = STORAGE_KEYS.CAPSULE_MODIFY_COUNT(publicKey.toBase58())
    const currentCount = parseInt(localStorage.getItem(countKey) || '0', 10)
    if (currentCount >= MAX_CAPSULE_MODIFICATIONS) {
      setError(`You have reached the maximum number of capsule modifications (${MAX_CAPSULE_MODIFICATIONS}) for this wallet.`)
      return
    }

    // Single authoritative validation gate (lib/schemas): amount format + wallet-balance ceiling,
    // beneficiary addresses + shares (sum to 100, no duplicates, no self), inactivity (whole number,
    // <= 100y), optional future target date, intent length, and email. Bad input never reaches a
    // wallet signature or the chain.
    const rawNftAssignments = selectedNftMints.map((mint) => ({
      mint,
      recipient: nftRecipients[nftAssignments[mint] ?? 0]?.address ?? '',
    }))
    const validation = capsuleType === 'token'
      ? createMultiAssetCapsuleInputSchema({
          ownerAddress: publicKey.toBase58(),
          assets: Object.fromEntries(
            walletAssets.map((asset) => [
              asset.key,
              {
                decimals: asset.decimals,
                maxBalance: asset.balanceUi,
                maxBaseUnits: asset.balanceBaseUnits,
              },
            ])
          ),
          allowMinutes: supportsMinuteMode,
        }).safeParse({
          assets: selectedAssets.map((asset) => ({ assetKey: asset.key, amount: asset.amount })),
          inactivityValue: inactivityDays,
          inactivityUnit,
          targetDate,
          intent,
          intentEmail,
          beneficiaries: beneficiaries.map((b) => ({ address: b.address, share: b.amount })),
        })
      : createNftCapsuleInputSchema({
          ownerAddress: publicKey.toBase58(),
          allowMinutes: supportsMinuteMode,
        }).safeParse({
          inactivityValue: inactivityDays,
          inactivityUnit,
          targetDate,
          intent,
          intentEmail,
          assignments: rawNftAssignments,
        })
    if (!validation.success) {
      setFieldErrors(collectFieldErrors(validation.error))
      setError(firstError(validation.error))
      return
    }
    setFieldErrors({})

    if (!wallet.signMessage) {
      setError('This wallet does not support message signing, which is required for encrypted intent delivery.')
      return
    }

    const signMessage = wallet.signMessage

    setIsPending(true)

    try {
      const accountLocations = await getCapsuleAccountLocations(publicKey)
      if (accountLocations.switch !== 'missing') {
        setExistingCapsule(true)
        setExistingCapsuleAddress(accountLocations.switchAddress)
        setExistingCapsuleCheck('ready')
        return
      }
      if (hasExistingCapsuleAccounts(accountLocations)) {
        throw new Error(
          'Existing capsule data needs recovery before a new capsule can be created. Refresh once, then contact support if this message remains.'
        )
      }

      const inactivityValueNum = parseInt(inactivityDays, 10)

      // ---- Off-chain CRE: encrypt the human intent statement and register it (decoupled from chain).
      // The lean on-chain capsule never stores the statement; only the beneficiary split lives on-chain.
      const normalizedEmail = intentEmail.trim().toLowerCase()
      const intentMessage = intent.trim()
      const recipientEmailHash = await sha256Hex(normalizedEmail)
      const messageHash = await sha256Hex(intentMessage)
      const timestamp = Date.now()
      const signatureMessage = buildIntentSignedMessage({
        action: 'register-secret',
        owner: publicKey.toBase58(),
        timestamp,
        recipientEmailHash,
        messageHash,
      })
      const signatureBytes = await signMessage(new TextEncoder().encode(signatureMessage))
      const signature = bytesToBase64(signatureBytes)

      const secretRes = await fetch('/api/intent-delivery/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          recipientEmail: normalizedEmail,
          message: intentMessage,
          timestamp,
          signature,
        }),
      })
      let secretJson: any
      try {
        secretJson = await secretRes.json()
      } catch {
        throw new Error(`CRE register returned ${secretRes.status} with empty response`)
      }
      if (!secretRes.ok) {
        throw new Error(secretJson?.error || 'Failed to register CRE secret')
      }

      // Fungible assets use proportional shares. NFT capsules still store their unique recipients as
      // beneficiaries (even shares) so any SOL rent swept at settlement has a deterministic route.
      const nftRecipientAddresses = [...new Set(rawNftAssignments.map((a) => a.recipient.trim()))]
      const leanBeneficiaries = capsuleType === 'token'
        ? beneficiaries
            .filter((b) => b.address.trim() && (b.chain ?? 'solana') !== 'evm')
            .map((b) => ({
              pubkey: new PublicKey(b.address.trim()),
              shareBps: Math.round(parseFloat(b.amount || '0') * 100),
            }))
        : nftRecipientAddresses.map((address, index) => {
            const base = Math.floor(10000 / nftRecipientAddresses.length)
            return {
              pubkey: new PublicKey(address),
              shareBps: index === nftRecipientAddresses.length - 1
                ? 10000 - base * (nftRecipientAddresses.length - 1)
                : base,
            }
          })
      if (leanBeneficiaries.length === 0) {
        throw new Error('Add at least one Solana beneficiary.')
      }
      const totalBps = leanBeneficiaries.reduce((s, b) => s + b.shareBps, 0)
      if (totalBps !== 10000) {
        throw new Error(`Beneficiary shares must total 100% (currently ${(totalBps / 100).toFixed(2)}%).`)
      }

      const onChainNftAssignments: OnChainNftAssignment[] = rawNftAssignments.map((assignment) => ({
        mint: new PublicKey(assignment.mint),
        recipient: new PublicKey(assignment.recipient.trim()),
      }))

      // ---- Deposit amounts: one transaction per fungible asset, or one unit per NFT ----
      const fungibleDeposits = capsuleType === 'token'
        ? selectedAssets.map((asset) => {
            const units = parseDecimalToBaseUnits(asset.amount, asset.decimals)
            if (units == null) {
              throw new Error(`Enter a valid ${asset.symbol} amount with at most ${asset.decimals} decimal places.`)
            }
            return {
              amountBaseUnits: new BN(units.toString()),
              mint: asset.mint ? new PublicKey(asset.mint) : null,
            }
          })
        : undefined

      const inactivityPeriodSeconds = inactivityUnitToSeconds(inactivityValueNum, inactivityUnit)

      // ---- Optional absolute fire date: fires regardless of activity, whichever comes first ----
      let targetDateSeconds: number | null = null
      if (targetDate) {
        const ts = Math.floor(new Date(targetDate + 'T00:00:00').getTime() / 1000)
        if (!Number.isFinite(ts)) {
          throw new Error('Enter a valid fixed fire date, or leave it blank.')
        }
        if (ts <= Math.floor(Date.now() / 1000)) {
          throw new Error('The fixed fire date must be in the future.')
        }
        targetDateSeconds = ts
      }

      // Create a draft, fund and delegate it, atomically seal the private TEE configuration, then
      // arm and schedule the regular-ER Switch. Beneficiaries never touch the base layer.
      const { baseSigs } = await createDelegatedCapsule(wallet as any, {
        inactivitySeconds: inactivityPeriodSeconds,
        targetDateSeconds,
        beneficiaries: leanBeneficiaries,
        fungibleDeposits,
        nftAssignments: capsuleType === 'nft' ? onChainNftAssignments : undefined,
        // heartbeat_authority defaults to the protocol relayer so the off-chain liveness service can
        // bump last_activity from detected wallet activity. Owner can still bump (on-chain is_owner
        // branch). Unset -> relayer default in createDelegatedCapsule.
        onStep: (label) => setCurrentStep(label),
      })
      const hash = baseSigs[0]
      setTxHash(hash)
      console.log('[create] capsule created + delegated to TEE. Base tx:', hash)

      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      const ownerBase58 = publicKey?.toBase58()

      // Increment modification count
      if (publicKey) {
        const newCount = currentCount + 1
        localStorage.setItem(countKey, String(newCount))
        setModifyCount(newCount)
      }

      // Save intent to localStorage
      if (intent.trim() && publicKey) {
        const key = STORAGE_KEYS.CAPSULE_INTENT(publicKey.toString(), Date.now())
        localStorage.setItem(key, intent)
      }

      // Save capsule creation transaction signature with unique key
      if (publicKey && hash) {
        const txKeyWithSig = STORAGE_KEYS.CAPSULE_CREATION_TX_WITH_SIG(publicKey.toString(), hash)
        localStorage.setItem(txKeyWithSig, hash)
        const txKey = STORAGE_KEYS.CAPSULE_CREATION_TX(publicKey.toString())
        localStorage.setItem(txKey, hash)
      }

      if (publicKey) {
        const [capsulePDA] = getCapsulePDA(publicKey)
        if (intentReminderEnabled) {
          try {
            const reminderTimestamp = Date.now()
            const singleFungibleAsset = selectedAssets.length === 1 ? selectedAssets[0] : null
            const reminderSignatureMessage = buildIntentSignedMessage({
              action: 'register-reminder',
              owner: publicKey.toBase58(),
              capsuleAddress: capsulePDA.toBase58(),
              timestamp: reminderTimestamp,
              recipientEmailHash,
            })
            const reminderSignatureBytes = await signMessage(new TextEncoder().encode(reminderSignatureMessage))
            const reminderSignature = bytesToBase64(reminderSignatureBytes)

            await fetch('/api/intent-reminder/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                capsuleAddress: capsulePDA.toBase58(),
                owner: publicKey.toBase58(),
                recipientEmail: normalizedEmail,
                assetSymbol:
                  capsuleType === 'nft'
                    ? 'NFT'
                    : singleFungibleAsset?.symbol ?? 'MULTI',
                assetLabel:
                  capsuleType === 'nft'
                    ? `${selectedNftMints.length} standard Solana NFT${selectedNftMints.length === 1 ? '' : 's'}`
                    : singleFungibleAsset
                      ? singleFungibleAsset.mint
                        ? `${singleFungibleAsset.symbol} (${singleFungibleAsset.mint})`
                        : 'Solana'
                      : `${selectedAssets.length} assets (${selectedAssets.map((asset) => asset.symbol).join(', ')})`,
                assetMint:
                  capsuleType === 'nft' && selectedNftMints.length === 1
                    ? selectedNftMints[0]
                    : capsuleType === 'token' && singleFungibleAsset
                      ? singleFungibleAsset.mint
                      : null,
                assetDecimals:
                  capsuleType === 'token' && singleFungibleAsset
                    ? singleFungibleAsset.decimals
                    : undefined,
                totalAmount:
                  capsuleType === 'token' && singleFungibleAsset
                    ? singleFungibleAsset.amount
                    : undefined,
                beneficiaryCount:
                  capsuleType === 'token'
                    ? beneficiaries.filter((b) => b.address.trim()).length
                    : nftRecipients.filter((r) => r.address.trim()).length,
                inactivityLabel: formatInactivityLabel(inactivityDays, inactivityUnit) || 'Not configured',
                delayDays: parseInt(delayDays, 10) || 0,
                createdAt: Date.now(),
                timestamp: reminderTimestamp,
                signature: reminderSignature,
              }),
            })
          } catch (reminderErr) {
            console.warn('[Reminder] Failed to register recurring reminder:', reminderErr)
          }
        }
      }

      if (ownerBase58) {
        setCurrentStep('Registering automation...')
        console.log('[Automation] Registering capsule owner for crank discovery...')
        let ownerRegistered = false
        for (let attempt = 0; attempt < 3 && !ownerRegistered; attempt++) {
          try {
            await registerCapsuleOwnerForAutomation(ownerBase58)
            ownerRegistered = true
            console.log('[Automation] Owner registration successful.')
          } catch (registryErr: any) {
            console.warn(`[Automation] Owner registration failed (attempt ${attempt + 1}/3):`, registryErr?.message)
            if (attempt < 2) await sleep(1500 * (attempt + 1))
          }
        }
        if (!ownerRegistered) {
          console.warn('[Automation] Owner registration for crank discovery did not succeed; the off-chain crank backstop may take longer to discover this capsule.')
        }
      }

      // Delegation to the TEE + the autonomous ScheduleTask crank already ran inside
      // createDelegatedCapsule above. The off-chain crank (owner registry) stays as the backstop for
      // inactivity windows that outlast the on-chain task's iteration budget.

      setCurrentStep(null)

      toast({ message: 'Capsule created', variant: 'success' })

      // Redirect to capsules page after successful creation
      window.location.assign('/capsules')
    } catch (err: any) {
      console.error('Error creating capsule:', err)
      const rawErrorMessage = err.message || 'Failed to create capsule'
      let errorMessage = normalizeTxError(err)

      // Check if error is "already processed" - this might mean the transaction succeeded
      // but we got an error response. Verify if capsule was actually created.
      if (rawErrorMessage.includes('already processed') || rawErrorMessage.includes('This transaction has already been processed')) {
        try {
          // Wait a bit for the transaction to be confirmed
          await new Promise(resolve => setTimeout(resolve, 2000))

          // Check if capsule was actually created
          if (publicKey) {
            const createdCapsule = await getCapsule(publicKey)
            if (createdCapsule && createdCapsule.isActive) {
              toast({ message: 'Capsule created', variant: 'success' })
              window.location.assign('/capsules')
              setIsPending(false)
              return
            }
          }
        } catch (checkError) {
          console.error('Error checking capsule after "already processed" error:', checkError)
        }

        // If capsule wasn't created, show appropriate error
        errorMessage = 'Transaction was already processed or duplicate submission. Please try again in a moment.'
      } else if (rawErrorMessage.includes('already in use') || rawErrorMessage.includes('custom program error: 0x0')) {
        errorMessage = 'A capsule already exists for this wallet. Please visit /capsules to view or update your existing capsule.'
      } else if (rawErrorMessage.includes('Simulation failed')) {
        if (rawErrorMessage.includes('already in use') || rawErrorMessage.includes('already processed')) {
          errorMessage = 'A capsule already exists for this wallet. Please visit /capsules to view or update your existing capsule.'
        } else {
          // For other simulation failures, check if it's because capsule already exists
          try {
            if (publicKey) {
              const existingCapsule = await getCapsule(publicKey)
              if (existingCapsule && !existingCapsule.executedAt) {
                errorMessage = existingCapsule.isActive
                  ? 'You already have an active capsule. Please cancel it or wait for execution.'
                  : 'An incomplete capsule draft exists. Open My Capsule, undelegate it if needed, then cancel it before retrying.'
              }
            }
          } catch (checkError) {
            console.error('Error checking capsule after simulation failure:', checkError)
          }
        }
      }

      const friendlyMessage = normalizeTxError(errorMessage)
      toast({ message: friendlyMessage, variant: 'error' })
      setError(friendlyMessage)
    } finally {
      setIsPending(false)
    }
  }

  const simulateExecution = () => {
    setShowSimulation(true)
  }

  const hasAssetSelection = capsuleType !== null && (
    capsuleType === 'token'
      ? selectedAssets.length > 0 && selectedAssets.every((asset) => Boolean(asset.amount.trim()))
      : selectedNftMints.length > 0
  )
  const nftAssignmentsComplete = capsuleType === 'nft' && selectedNftMints.length > 0 &&
    selectedNftMints.every((mint) => {
      const recipientIndex = nftAssignments[mint] ?? 0
      const recipient = nftRecipients[recipientIndex]?.address.trim() ?? ''
      return isValidSolanaAddress(recipient)
    })
  const hasBeneficiaryDetails = capsuleType === 'token'
    ? beneficiaries.some((b) => b.address.trim() && b.amount.trim()) && Boolean(inactivityDays)
    : capsuleType === 'nft'
      ? nftAssignmentsComplete && Boolean(inactivityDays)
      : false
  const hasIntentDetails = Boolean(intent.trim() && isValidEmail(intentEmail))
  const canCompleteAsset = hasAssetSelection
  const canCompleteBeneficiaries = hasBeneficiaryDetails
  const canCompleteIntent = hasIntentDetails
  const isCreateReady = Boolean(
    connected &&
    publicKey &&
    hasAssetSelection &&
    hasBeneficiaryDetails &&
    hasIntentDetails &&
    !isPending &&
    !existingCapsule &&
    existingCapsuleCheck === 'ready' &&
    modifyCount < MAX_CAPSULE_MODIFICATIONS &&
    wallet.signMessage &&
    isValidEmail(intentEmail) &&
    inactivityDays &&
    parseInt(inactivityDays) > 0 &&
    (
      (capsuleType === 'token' && beneficiaries.length > 0 && beneficiaries.every((b) => !b.address || !b.amount ? false : true)) ||
      (capsuleType === 'nft' && nftAssignmentsComplete)
    )
  )
  // Step completion derives live from validity - no separate "I confirm this step" state.
  const currentStepIndex = !canCompleteAsset
    ? 1
    : !canCompleteBeneficiaries
      ? 2
      : !canCompleteIntent
        ? 3
        : 4
  const currentStepMeta = !canCompleteAsset
    ? 'Choose what goes into the capsule first.'
    : !canCompleteBeneficiaries
      ? 'Set recipients, timing, and secure delivery.'
      : !canCompleteIntent
        ? 'Write the instruction beneficiaries will receive.'
        : 'Review the final payload and create the capsule.'
  const isFaqOpen = (key: string) => openFaq === key

  return {
    // wallet
    wallet,
    publicKey,
    connected,
    // core form state
    intent,
    setIntent: (v: string) => { clearFieldErrors(); setIntent(v) },
    capsuleType,
    setCapsuleType,
    selectedAssetKeys,
    assetAmounts,
    beneficiaries,
    inactivityDays,
    setInactivityDays: (v: string) => { clearFieldErrors(); setInactivityDays(v) },
    inactivityUnit,
    setInactivityUnit: (v: InactivityUnit) => { clearFieldErrors(); setInactivityUnit(v) },
    inactivityUnitOptions,
    inactivityPresets: INACTIVITY_PRESETS[inactivityUnit],
    inactivityPlaceholder: INACTIVITY_PLACEHOLDER[inactivityUnit],
    targetDate,
    setTargetDate: (v: string) => { clearFieldErrors(); setTargetDate(v) },
    // wizard UI state
    showSimulation,
    setShowSimulation,
    isPending,
    currentStep,
    txHash,
    error,
    fieldErrors,
    existingCapsule,
    existingCapsuleAddress,
    existingCapsuleCheck,
    existingCapsuleCheckError,
    retryExistingCapsuleCheck: () => setExistingCapsuleCheckAttempt((attempt) => attempt + 1),
    modifyCount,
    openSection,
    setOpenSection,
    openFaq,
    setOpenFaq,
    isFaqOpen,
    // NFT flow
    nftList,
    nftListLoading,
    selectedNftMints,
    nftRecipients,
    nftAssignments,
    // intent delivery
    intentEmail,
    setIntentEmail: (v: string) => { clearFieldErrors(); setIntentEmail(v) },
    intentReminderEnabled,
    setIntentReminderEnabled,
    // wallet token reads
    walletTokens,
    walletAssets,
    tokensLoading,
    solBalanceLoading: solBalance.isLoading,
    // derived
    supportsMinuteMode,
    selectedAssets,
    assetUnit,
    approxFireDate,
    minTargetDate,
    // beneficiary handlers
    addBeneficiary,
    splitEvenly,
    removeBeneficiary,
    updateBeneficiary,
    toggleAssetSelection,
    setAssetAmount,
    // NFT handlers
    toggleNftSelection,
    addNftRecipient,
    removeNftRecipient,
    setNftRecipientAddress,
    setNftAssignment,
    // helpers
    formatInactivityLabel,
    // submission
    handleCreate,
    simulateExecution,
    // gates
    hasAssetSelection,
    hasBeneficiaryDetails,
    hasIntentDetails,
    canCompleteAsset,
    canCompleteBeneficiaries,
    canCompleteIntent,
    isCreateReady,
    currentStepIndex,
    currentStepMeta,
  }
}

'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { useToast } from '@/components/ui'
import { maskAddress } from '@/lib/format'
import { normalizeTxError } from '@/lib/errors'
import { createDelegatedCapsule, getCapsule, registerCapsuleOwnerForAutomation } from '@/lib/solana'
import { getCapsulePDA } from '@/lib/program'
import { Beneficiary } from '@/types'
import {
  DEFAULT_VALUES,
  STORAGE_KEYS,
  SOLANA_CONFIG,
  MAX_CAPSULE_MODIFICATIONS,
} from '@/constants'
import { daysToSeconds } from '@/utils/intent'
import { isValidAmountString } from '@/lib/assets'
import { getVaultTokenAccounts } from '@/lib/spl'
import { buildIntentSignedMessage } from '@/utils/intentAuth'
import { bytesToBase64, sha256Hex } from '@/utils/intentClient'
import {
  validateBeneficiaryAddresses,
  validateBeneficiaryAmounts,
  validatePercentageTotals,
  isValidEmail,
} from '@/utils/validation'
import { getSolanaConnection } from '@/config/solana'
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { queryKeys } from '@/lib/query/keys'

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

// A fungible SPL token detected in the connected wallet (classic SPL or Token-2022), lockable as the
// capsule asset. `mint`/`tokenProgram` are base58; `balanceUi` is the human-readable balance.
type WalletToken = { mint: string; decimals: number; symbol: string; balanceUi: number; tokenProgram: string }

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
    answer: 'One wallet manages one active capsule flow at a time. After execution or deactivation, you can create or recreate another capsule.',
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
  const wallet = useWallet()
  const { publicKey, connected } = wallet
  const { toast } = useToast()
  const [intent, setIntent] = useState('')
  const [capsuleType, setCapsuleType] = useState<CapsuleAssetType>(null)
  // Asset to lock: null = native SOL; otherwise the chosen SPL token's mint (auto-detected from the
  // connected wallet, classic SPL or Token-2022). The vault accepts any token the wallet holds.
  const [selectedAssetMint, setSelectedAssetMint] = useState<string | null>(null)
  const beneficiaryIdRef = useRef(1)
  const [beneficiaries, setBeneficiaries] = useState<UiBeneficiary[]>([
    { id: 'b0', chain: 'solana', address: '', amount: '100', amountType: 'percentage', destinationChainSelector: '' }
  ])
  const [totalAmount, setTotalAmount] = useState('')
  const [inactivityDays, setInactivityDays] = useState('')
  const [inactivityUnit, setInactivityUnit] = useState<InactivityUnit>('days')
  // Optional absolute fire date (YYYY-MM-DD). When set, the capsule ALSO fires on this date regardless
  // of activity - whichever trigger (inactivity or this date) comes first wins. Empty = inactivity-only.
  const [targetDate, setTargetDate] = useState('')
  // The on-chain grace window is a fixed 48h constant; delayDays is kept only as reminder metadata.
  const delayDays = DEFAULT_VALUES.DELAY_DAYS
  const [showSimulation, setShowSimulation] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [currentStep, setCurrentStep] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [existingCapsule, setExistingCapsule] = useState<boolean>(false)
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

  // Check for existing capsule on mount and load modification count
  useEffect(() => {
    const checkExistingCapsule = async () => {
      if (connected && publicKey) {
        // Load modification count from localStorage
        const countKey = STORAGE_KEYS.CAPSULE_MODIFY_COUNT(publicKey.toBase58())
        const stored = localStorage.getItem(countKey)
        setModifyCount(stored ? parseInt(stored, 10) || 0 : 0)

        try {
          const capsule = await getCapsule(publicKey)
          // Only show warning if capsule is active AND not executed
          // If capsule is executed, we can recreate it, so don't show warning
          if (capsule && capsule.isActive && !capsule.executedAt) {
            setExistingCapsule(true)
          } else {
            // Allow creation/recreation if:
            // 1. Capsule doesn't exist
            // 2. Capsule is executed (executedAt is set) - can recreate
            // 3. Capsule exists but isActive is false
            setExistingCapsule(false)
          }
        } catch (err) {
          console.error('Error checking for existing capsule:', err)
          setExistingCapsule(false)
        }
      }
    }
    checkExistingCapsule()
  }, [connected, publicKey])

  // Add a recipient and re-split shares evenly so they always total 100% (1 -> 100, 2 -> 50/50, ...).
  const addBeneficiary = () => {
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
    queryFn: async (): Promise<WalletToken[]> => {
      const accts = await getVaultTokenAccounts(getSolanaConnection(), publicKey!)
      const tokens: WalletToken[] = accts
        .filter((t) => t.amount > 0n && !(t.decimals === 0 && t.amount === 1n))
        .map((t) => ({
          mint: t.mint.toBase58(),
          decimals: t.decimals,
          symbol: maskAddress(t.mint.toBase58()),
          balanceUi: Number(t.amount) / Math.pow(10, t.decimals),
          tokenProgram: t.tokenProgram.toBase58(),
        }))
        .sort((a, b) => b.balanceUi - a.balanceUi)
      return tokens
    },
  })
  const walletTokens = tokensQuery.data ?? []
  const tokensLoading = tokensQuery.isFetching

  // Resolve the chosen asset from the detected wallet tokens (null mint = native SOL).
  const selectedToken = selectedAssetMint ? walletTokens.find((t) => t.mint === selectedAssetMint) ?? null : null
  const assetUnit = selectedToken?.symbol ?? 'SOL'
  const assetDecimals = selectedToken?.decimals ?? 9
  const selectedMintPk = selectedToken ? new PublicKey(selectedToken.mint) : undefined

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
    setBeneficiaries((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((_, i) => i !== index)
      const shares = evenShares(next.length)
      return next.map((b, i) => ({ ...b, amount: shares[i] }))
    })
  }

  const toggleNftSelection = (mint: string) => {
    setSelectedNftMints((prev) =>
      prev.includes(mint) ? prev.filter((m) => m !== mint) : [...prev, mint]
    )
  }

  const addNftRecipient = () => {
    setNftRecipients((prev) => [...prev, { address: '' }])
  }

  const removeNftRecipient = (index: number) => {
    if (nftRecipients.length > 1) {
      setNftRecipients((prev) => prev.filter((_, i) => i !== index))
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

  const validateBeneficiaries = (): boolean => {
    if (selectedToken) {
      const amt = parseFloat(totalAmount)
      if (Number.isFinite(amt) && amt > selectedToken.balanceUi) {
        setError(`You only have ${selectedToken.balanceUi} ${selectedToken.symbol} in your wallet.`)
        return false
      }
    }

    // Format parity with the on-chain parser (audit M1): totalAmount is parsed by the program.
    if (!isValidAmountString(totalAmount)) {
      setError('Enter a valid total amount to fund the capsule (digits only, e.g. 1.5).')
      return false
    }

    if (!validateBeneficiaryAddresses(beneficiaries)) {
      setError('Enter a valid Solana address for every beneficiary.')
      return false
    }

    if (!validateBeneficiaryAmounts(beneficiaries)) {
      setError('Enter a valid share for every beneficiary.')
      return false
    }

    if (!validatePercentageTotals(beneficiaries)) {
      const totalPercentage = beneficiaries.reduce((sum, b) => sum + parseFloat(b.amount || '0'), 0)
      setError(`Beneficiary shares must total 100% (currently ${totalPercentage.toFixed(2)}%). Use "Split evenly" to fix.`)
      return false
    }

    return true
  }

  const handleCreate = async () => {
    setError(null)
    if (!connected || !publicKey) {
      setError('Please connect your Solana wallet.')
      return
    }

    // Lean program: only token (SOL / SPL) capsules with proportional Solana beneficiaries are
    // supported. NFT (per-recipient) capsules return in a later release.
    if (capsuleType !== 'token') {
      setError('Please select the Token asset type. NFT capsules are temporarily unavailable.')
      return
    }

    // Check modification limit (3 per wallet)
    const countKey = STORAGE_KEYS.CAPSULE_MODIFY_COUNT(publicKey.toBase58())
    const currentCount = parseInt(localStorage.getItem(countKey) || '0', 10)
    if (currentCount >= MAX_CAPSULE_MODIFICATIONS) {
      setError(`You have reached the maximum number of capsule modifications (${MAX_CAPSULE_MODIFICATIONS}) for this wallet.`)
      return
    }

    if (!validateBeneficiaries()) return

    if (!intent.trim()) {
      setError('Please write an intent statement.')
      return
    }

    if (!inactivityDays || parseInt(inactivityDays) <= 0) {
      setError('Set a valid inactivity period before creating.')
      return
    }

    if (!wallet.signMessage) {
      setError('This wallet does not support message signing, which is required for encrypted intent delivery.')
      return
    }
    if (!isValidEmail(intentEmail)) {
      setError('Enter a valid representative email address.')
      return
    }

    const signMessage = wallet.signMessage

    setIsPending(true)

    try {
      const inactivityValueNum = parseInt(inactivityDays, 10)
      const selectedMint = selectedMintPk

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

      // ---- Lean beneficiaries: Solana pubkeys + proportional share_bps (must sum to 10000 = 100%) ----
      const leanBeneficiaries = beneficiaries
        .filter((b) => b.address.trim() && (b.chain ?? 'solana') !== 'evm')
        .map((b) => ({
          pubkey: new PublicKey(b.address.trim()),
          shareBps: Math.round(parseFloat(b.amount || '0') * 100),
        }))
      if (leanBeneficiaries.length === 0) {
        throw new Error('Add at least one Solana beneficiary.')
      }
      const totalBps = leanBeneficiaries.reduce((s, b) => s + b.shareBps, 0)
      if (totalBps !== 10000) {
        throw new Error(`Beneficiary shares must total 100% (currently ${(totalBps / 100).toFixed(2)}%).`)
      }

      // ---- Deposit amount: SOL lamports, or SPL base units ----
      const totalAmountNum = parseFloat(totalAmount)
      if (!Number.isFinite(totalAmountNum) || totalAmountNum <= 0) {
        throw new Error('Enter a valid total amount to fund the capsule.')
      }
      const depositBaseUnits = selectedMint
        ? Math.round(totalAmountNum * Math.pow(10, assetDecimals))
        : Math.round(totalAmountNum * LAMPORTS_PER_SOL)

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

      // ---- Determine create vs recreate: one capsule per wallet, reuse only after it has fired ----
      const existingCapsule = await getCapsule(publicKey)
      if (existingCapsule && existingCapsule.isActive) {
        throw new Error('You already have an active capsule. It must be executed or cancelled before creating a new one. Visit /capsules to view it.')
      }
      const recreate = !!(existingCapsule && !existingCapsule.isActive && existingCapsule.executedAt)

      // ---- The single intended flow: create + fund + delegate the Switch to the TEE, then set the
      // PRIVATE beneficiary list + schedule the autonomous crank INSIDE the TEE. Beneficiaries never
      // touch the base layer - that is the privacy guarantee. There is no base-only fork. ----
      const { baseSigs } = await createDelegatedCapsule(wallet as any, {
        inactivitySeconds: inactivityPeriodSeconds,
        targetDateSeconds,
        beneficiaries: leanBeneficiaries,
        depositBaseUnits,
        mint: selectedMint ?? null,
        // heartbeat_authority defaults to the protocol relayer so the off-chain liveness service can
        // bump last_activity from detected wallet activity. Owner can still bump (on-chain is_owner
        // branch). Unset -> relayer default in createDelegatedCapsule.
        recreate,
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
                assetSymbol: assetUnit,
                assetLabel: selectedToken ? `${selectedToken.symbol} (${selectedToken.mint})` : 'Solana',
                assetMint: selectedToken?.mint ?? null,
                assetDecimals,
                totalAmount: capsuleType === 'token' ? totalAmount : undefined,
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
      window.location.href = '/capsules'
    } catch (err: any) {
      console.error('Error creating capsule:', err)
      let errorMessage = err.message || 'Failed to create capsule'

      // Check if error is "already processed" - this might mean the transaction succeeded
      // but we got an error response. Verify if capsule was actually created.
      if (errorMessage.includes('already processed') || errorMessage.includes('This transaction has already been processed')) {
        try {
          // Wait a bit for the transaction to be confirmed
          await new Promise(resolve => setTimeout(resolve, 2000))

          // Check if capsule was actually created
          if (publicKey) {
            const createdCapsule = await getCapsule(publicKey)
            if (createdCapsule && createdCapsule.isActive) {
              toast({ message: 'Capsule created', variant: 'success' })
              window.location.href = '/capsules'
              setIsPending(false)
              return
            }
          }
        } catch (checkError) {
          console.error('Error checking capsule after "already processed" error:', checkError)
        }

        // If capsule wasn't created, show appropriate error
        errorMessage = 'Transaction was already processed or duplicate submission. Please try again in a moment.'
      } else if (errorMessage.includes('already in use') || errorMessage.includes('custom program error: 0x0')) {
        errorMessage = 'A capsule already exists for this wallet. Please visit /capsules to view or update your existing capsule.'
      } else if (errorMessage.includes('Simulation failed')) {
        if (errorMessage.includes('already in use') || errorMessage.includes('already processed')) {
          errorMessage = 'A capsule already exists for this wallet. Please visit /capsules to view or update your existing capsule.'
        } else {
          // For other simulation failures, check if it's because capsule already exists
          try {
            if (publicKey) {
              const existingCapsule = await getCapsule(publicKey)
              if (existingCapsule && existingCapsule.isActive && !existingCapsule.executedAt) {
                errorMessage = 'You already have an active capsule. Please deactivate it first or update the existing one.'
              }
            }
          } catch (checkError) {
            console.error('Error checking capsule after simulation failure:', checkError)
          }
        }
      }

      toast({ message: normalizeTxError(err), variant: 'error' })
      setError(errorMessage)
    } finally {
      setIsPending(false)
    }
  }

  const simulateExecution = () => {
    setShowSimulation(true)
  }

  const hasAssetSelection = capsuleType !== null && (
    capsuleType === 'token'
      ? Boolean(totalAmount.trim())
      : selectedNftMints.length > 0
  )
  const hasBeneficiaryDetails = capsuleType === 'token'
    ? beneficiaries.some((b) => b.address.trim() && b.amount.trim()) && Boolean(inactivityDays)
    : capsuleType === 'nft'
      ? selectedNftMints.length > 0 && nftRecipients.some((r) => r.address.trim()) && Boolean(inactivityDays)
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
    modifyCount < MAX_CAPSULE_MODIFICATIONS &&
    wallet.signMessage &&
    isValidEmail(intentEmail) &&
    inactivityDays &&
    parseInt(inactivityDays) > 0 &&
    (
      (capsuleType === 'token' && beneficiaries.length > 0 && beneficiaries.every((b) => !b.address || !b.amount ? false : true)) ||
      (capsuleType === 'nft' && selectedNftMints.length > 0 && nftRecipients.some((r) => r.address.trim()))
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
    setIntent,
    capsuleType,
    setCapsuleType,
    selectedAssetMint,
    setSelectedAssetMint,
    beneficiaries,
    totalAmount,
    setTotalAmount,
    inactivityDays,
    setInactivityDays,
    inactivityUnit,
    setInactivityUnit,
    inactivityUnitOptions,
    inactivityPresets: INACTIVITY_PRESETS[inactivityUnit],
    inactivityPlaceholder: INACTIVITY_PLACEHOLDER[inactivityUnit],
    targetDate,
    setTargetDate,
    // wizard UI state
    showSimulation,
    setShowSimulation,
    isPending,
    currentStep,
    txHash,
    error,
    existingCapsule,
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
    setIntentEmail,
    intentReminderEnabled,
    setIntentReminderEnabled,
    // wallet token reads
    walletTokens,
    tokensLoading,
    // derived
    supportsMinuteMode,
    selectedToken,
    assetUnit,
    assetDecimals,
    approxFireDate,
    minTargetDate,
    // beneficiary handlers
    addBeneficiary,
    splitEvenly,
    removeBeneficiary,
    updateBeneficiary,
    validateBeneficiaries,
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

'use client'

import { useState, useEffect, useRef } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import dynamic from 'next/dynamic'
import { Clock, User, Shield, Eye, Plus, X, CheckCircle, ChevronDown, ChevronUp, Coins, ImageIcon, ExternalLink } from 'lucide-react'

// Dynamic import to prevent hydration errors
const WalletMultiButton = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false }
)
import { createDelegatedCapsule, getCapsule, registerCapsuleOwnerForAutomation } from '@/lib/solana'
import { getCapsulePDA } from '@/lib/program'
import { Beneficiary } from '@/types'
import {
  DEFAULT_VALUES,
  STORAGE_KEYS,
  SOLANA_CONFIG,
  PLATFORM_FEE,
  MAX_CAPSULE_MODIFICATIONS,
  getAssetMintEnvKey,
} from '@/constants'
import { daysToSeconds } from '@/utils/intent'
import { getAssetConfig, getAssetMintPublicKey, isAssetConfigured, isValidAmountString, SUPPORTED_TOKEN_ASSETS, SupportedAssetSymbol } from '@/lib/assets'
import { buildCreSignedMessage } from '@/utils/creAuth'
import { bytesToBase64, encryptPrivateMessage, sha256Hex } from '@/utils/creCrypto'
import {
  isValidBeneficiaryAddress,
  validateBeneficiaryAddresses,
  validateBeneficiaryAmounts,
  validatePercentageTotals,
  isValidEmail,
} from '@/utils/validation'
import { getSolanaConnection, isValidSolanaAddress } from '@/config/solana'
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { SectionEyebrow, ServiceAccordionSection, ServiceMetaCard, ServicePageHeader } from '@/components/ui/service-page'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

export type CapsuleAssetType = 'token' | 'nft' | null
type InactivityUnit = 'days' | 'minutes'

export type NftItem = { mint: string; name?: string; symbol?: string; imageUri?: string }

// The lean program is Solana-only + proportional, so a UI beneficiary is just an address + a % share.
// A stable id keeps React keys correct across add/remove (index keys mis-associate inputs on removal).
type UiBeneficiary = Beneficiary & { id: string }

// Split 100% evenly across n recipients; the last absorbs the rounding remainder so the displayed
// shares always total exactly 100 (and the derived share_bps total exactly 10000).
function evenShares(n: number): string[] {
  if (n <= 0) return []
  const base = Math.floor((10000 / n)) / 100 // 2dp floor of the per-head percentage
  const shares = Array(n).fill(base)
  shares[n - 1] = Math.round((100 - base * (n - 1)) * 100) / 100
  return shares.map((s) => String(s))
}

const CREATE_STEPS = [
  { key: 'asset', label: 'Select Asset Type' },
  { key: 'beneficiary', label: 'Configure Beneficiaries' },
  { key: 'intent', label: 'Declare Your Intent' },
  { key: 'review', label: 'Review & Create' },
] as const

const CREATE_FAQS = [
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

export default function CreatePage() {
  const wallet = useWallet()
  const { publicKey, connected } = wallet
  const [intent, setIntent] = useState('')
  const [capsuleType, setCapsuleType] = useState<CapsuleAssetType>(null)
  const [selectedTokenAsset, setSelectedTokenAsset] = useState<SupportedAssetSymbol>('SOL')
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
  const [nftList, setNftList] = useState<NftItem[]>([])
  const [nftListLoading, setNftListLoading] = useState(false)
  const [selectedNftMints, setSelectedNftMints] = useState<string[]>([])
  const [nftRecipients, setNftRecipients] = useState<{ address: string }[]>([{ address: '' }])
  const [nftAssignments, setNftAssignments] = useState<Record<string, number>>({})
  // Intent Statement email delivery (CRE)
  const [creEmail, setCreEmail] = useState('')
  const [creUnlockCode, setCreUnlockCode] = useState('')
  const [creReminderEnabled, setCreReminderEnabled] = useState(true)

  // Fetch wallet NFTs when NFT path is selected (Helius DAS when API key set, else RPC)
  useEffect(() => {
    if (capsuleType !== 'nft' || !publicKey || !connected) return
    let cancelled = false
    setNftListLoading(true)

    const run = async () => {
      if (SOLANA_CONFIG.HELIUS_API_KEY) {
        try {
          const res = await fetch(`/api/helius/nfts?wallet=${encodeURIComponent(publicKey.toBase58())}`, {
            cache: 'no-store',
          })
          const payload = await res.json().catch(() => null)
          if (!res.ok || !payload) {
            throw new Error(payload?.error || `NFT request failed (${res.status})`)
          }
          const items = Array.isArray(payload.items) ? payload.items as Array<{ mint: string; name?: string; symbol?: string; imageUri?: string }> : []
          if (cancelled) return
          const nfts: NftItem[] = items.map((item) => ({
            mint: item.mint,
            name: item.name,
            symbol: item.symbol,
            imageUri: item.imageUri,
          }))
          setNftList(nfts)
        } catch {
          if (!cancelled) setNftList([])
        } finally {
          if (!cancelled) setNftListLoading(false)
        }
        return
      }

      const connection = getSolanaConnection()
      connection
        .getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID })
        .then(({ value }) => {
          if (cancelled) return
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
          setNftList(nfts)
        })
        .catch(() => {
          if (!cancelled) setNftList([])
        })
        .finally(() => {
          if (!cancelled) setNftListLoading(false)
        })
    }

    run()
    return () => { cancelled = true }
  }, [capsuleType, publicKey, connected])

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
  const tokenAssetConfig = getAssetConfig(selectedTokenAsset)
  const tokenAssetUnit = tokenAssetConfig.symbol
  const tokenAssetReady = isAssetConfigured(selectedTokenAsset)

  const formatInactivityLabel = (value: string | number, unit: InactivityUnit) => {
    const numeric = typeof value === 'number' ? value : parseInt(value, 10)
    if (!Number.isFinite(numeric) || numeric <= 0) return ''
    const label = unit === 'minutes'
      ? (numeric === 1 ? 'minute' : 'minutes')
      : (numeric === 1 ? 'day' : 'days')
    return `${numeric} ${label}`
  }

  // Approximate calendar date the switch would fire if the owner goes silent from today (days mode).
  const approxFireDate = (() => {
    const days = parseInt(inactivityDays, 10)
    if (inactivityUnit !== 'days' || !Number.isFinite(days) || days <= 0) return ''
    const d = new Date()
    d.setDate(d.getDate() + days)
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
    if (!tokenAssetReady) {
      setError(`${selectedTokenAsset} mint is not configured. Set ${getAssetMintEnvKey(selectedTokenAsset)} first.`)
      return false
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
    if (!isValidEmail(creEmail)) {
      setError('Enter a valid representative email address.')
      return
    }
    if (creUnlockCode.trim().length < 6) {
      setError('Set an access code with at least 6 characters.')
      return
    }

    const signMessage = wallet.signMessage

    setIsPending(true)

    try {
      const inactivityValueNum = parseInt(inactivityDays, 10)
      const selectedMint = getAssetMintPublicKey(selectedTokenAsset)

      // ---- Off-chain CRE: encrypt the human intent statement and register it (decoupled from chain).
      // The lean on-chain capsule never stores the statement; only the beneficiary split lives on-chain.
      const normalizedEmail = creEmail.trim().toLowerCase()
      const encryptedPayload = await encryptPrivateMessage(intent.trim(), creUnlockCode)
      const recipientEmailHash = await sha256Hex(normalizedEmail)
      const encryptedPayloadHash = await sha256Hex(encryptedPayload)
      const timestamp = Date.now()
      const signatureMessage = buildCreSignedMessage({
        action: 'register-secret',
        owner: publicKey.toBase58(),
        timestamp,
        recipientEmailHash,
        encryptedPayloadHash,
      })
      const signatureBytes = await signMessage(new TextEncoder().encode(signatureMessage))
      const signature = bytesToBase64(signatureBytes)

      const secretRes = await fetch('/api/intent-delivery/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          recipientEmail: normalizedEmail,
          encryptedPayload,
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
        ? Math.round(totalAmountNum * Math.pow(10, tokenAssetConfig.decimals))
        : Math.round(totalAmountNum * LAMPORTS_PER_SOL)

      const inactivityPeriodSeconds = inactivityUnit === 'minutes'
        ? inactivityValueNum * 60
        : daysToSeconds(inactivityValueNum)

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
        if (creReminderEnabled) {
          try {
            const reminderTimestamp = Date.now()
            const reminderSignatureMessage = buildCreSignedMessage({
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
                assetSymbol: tokenAssetConfig.symbol,
                assetLabel: tokenAssetConfig.label,
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
  const hasIntentDetails = Boolean(intent.trim() && isValidEmail(creEmail) && creUnlockCode.trim().length >= 6)
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
    isValidEmail(creEmail) &&
    creUnlockCode.trim().length >= 6 &&
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

  return (
    <div className="min-h-screen bg-hero pt-24 pb-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="mb-6">
          <ServicePageHeader
            eyebrow={<SectionEyebrow>Capsule Builder</SectionEyebrow>}
            title="Create Capsule"
            description="Build the asset payload, define beneficiaries, set trigger conditions, then encrypt the human instruction that accompanies the capsule."
            statusLine={currentStepMeta}
            badges={
              <>
                <span className="create-status-chip">
                  <span className="create-status-chip__dot" />
                  {SOLANA_CONFIG.NETWORK}
                </span>
                <span className="create-status-chip">
                  <span className="create-status-chip__dot" />
                  {capsuleType === 'token' ? `Asset: ${tokenAssetUnit}` : capsuleType === 'nft' ? `NFTs: ${selectedNftMints.length}` : 'Asset pending'}
                </span>
                <span className="create-status-chip">
                  <span className="create-status-chip__dot" />
                  PER (TEE) secured
                </span>
              </>
            }
            aside={
              <div className="service-meta-card service-meta-card--accent p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-Heres-muted">Current Snapshot</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  <ServiceMetaCard label="Asset" className="bg-Heres-surface/20 shadow-none">
                    <p className="text-[15px] font-semibold text-Heres-white">
                      {capsuleType === 'token' ? `${tokenAssetUnit} capsule` : capsuleType === 'nft' ? 'NFT capsule' : 'Not selected'}
                    </p>
                  </ServiceMetaCard>
                  <ServiceMetaCard label="Recipients" className="bg-Heres-surface/20 shadow-none">
                    <p className="text-[15px] font-semibold text-Heres-white">
                      {capsuleType === 'token'
                        ? beneficiaries.filter((b) => b.address.trim()).length
                        : nftRecipients.filter((r) => r.address.trim()).length}
                    </p>
                  </ServiceMetaCard>
                  <ServiceMetaCard label="Readiness" className="bg-Heres-surface/20 shadow-none">
                    <p className={`text-[15px] font-semibold ${isCreateReady ? 'text-emerald-400' : 'text-Heres-accent'}`}>
                      {isCreateReady ? 'Ready to create' : `Step ${currentStepIndex} of ${CREATE_STEPS.length}`}
                    </p>
                  </ServiceMetaCard>
                </div>
              </div>
            }
          />
          <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-Heres-surface/80">
            <div
              className="h-full rounded-full bg-gradient-to-r from-Heres-cyan via-Heres-cyan to-emerald-400 transition-all duration-500"
              style={{ width: `${(currentStepIndex / CREATE_STEPS.length) * 100}%` }}
            />
          </div>
          <div className="mt-3.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {CREATE_STEPS.map((step, index) => {
              const isCompleted = (
                (step.key === 'asset' && canCompleteAsset) ||
                (step.key === 'beneficiary' && canCompleteBeneficiaries) ||
                (step.key === 'intent' && canCompleteIntent) ||
                (step.key === 'review' && isCreateReady)
              )
              const isCurrent = (
                (step.key === 'asset' && !canCompleteAsset) ||
                (step.key === 'beneficiary' && canCompleteAsset && !canCompleteBeneficiaries) ||
                (step.key === 'intent' && canCompleteBeneficiaries && !canCompleteIntent) ||
                (step.key === 'review' && canCompleteIntent)
              )
              return (
                <button
                  type="button"
                  key={step.key}
                  onClick={() => setOpenSection(
                    step.key === 'asset'
                      ? 'asset'
                      : step.key === 'beneficiary'
                        ? 'beneficiaries'
                        : step.key === 'intent'
                          ? 'intent'
                          : 'review'
                  )}
                  className={`rounded-xl border px-3 py-2.5 transition-colors ${
                    isCurrent
                      ? 'border-Heres-accent/40 bg-Heres-accent/10'
                      : isCompleted
                        ? 'border-emerald-400/20 bg-emerald-400/5'
                        : 'border-Heres-border bg-Heres-card/40'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`inline-flex h-5.5 w-5.5 items-center justify-center rounded-full text-[10px] font-semibold ${
                      isCompleted
                        ? 'bg-emerald-400 text-Heres-bg'
                        : isCurrent
                          ? 'bg-Heres-accent text-Heres-bg'
                          : 'bg-Heres-surface text-Heres-muted'
                    }`}>
                      {index + 1}
                    </span>
                    <span className={`text-[12px] font-medium ${isCurrent ? 'text-Heres-white' : isCompleted ? 'text-emerald-300' : 'text-Heres-muted'}`}>
                      {step.label}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </header>

        <div className="space-y-5">
          {!connected && (
            <div className="card-Heres p-8 text-center">
              <Shield className="mx-auto mb-5 h-14 w-14 text-Heres-accent" />
              <h2 className="text-2xl font-bold text-Heres-white">Connect Your Wallet</h2>
              <p className="mx-auto mt-3 max-w-2xl text-Heres-muted">
                Connect Phantom or another Solana wallet to unlock capsule creation and NFT/token selection.
              </p>
              <div className="mt-6 flex justify-center">
                <WalletMultiButton className="!h-11 !rounded-xl !bg-Heres-surface !px-5 !py-0 !text-sm !font-medium !text-Heres-white transition-opacity hover:!bg-Heres-card active:scale-95" />
              </div>
            </div>
          )}

          {connected && modifyCount >= MAX_CAPSULE_MODIFICATIONS && (
            <div className="card-Heres border-red-500/40 bg-red-500/5 p-6">
              <div className="flex items-start gap-4">
                <Shield className="mt-0.5 h-6 w-6 flex-shrink-0 text-red-400" />
                <div className="flex-1">
                  <h3 className="mb-2 text-lg font-semibold text-red-400">Modification Limit Reached</h3>
                  <p className="text-Heres-muted">
                    You have used all {MAX_CAPSULE_MODIFICATIONS} capsule modifications for this wallet. No further changes are allowed.
                  </p>
                </div>
              </div>
            </div>
          )}

          {connected && modifyCount > 0 && modifyCount < MAX_CAPSULE_MODIFICATIONS && (
            <div className="rounded-lg border border-Heres-border bg-Heres-surface/50 px-4 py-3 text-sm text-Heres-muted">
              Capsule modifications used: <span className="font-medium text-Heres-white">{modifyCount}</span> / {MAX_CAPSULE_MODIFICATIONS}
            </div>
          )}

          <ServiceAccordionSection
            step="Step 1"
            title="Select Asset Type"
            description="Select your preferred asset type."
            open={openSection === 'asset'}
            onToggle={() => setOpenSection((prev) => (prev === 'asset' ? 'beneficiaries' : 'asset'))}
          >
              <div>
                <div className="flex flex-wrap gap-4">
                  <button
                    type="button"
                    onClick={() => setCapsuleType('token')}
                    className={`inline-flex items-center gap-3 rounded-xl border px-5 py-3 text-sm font-medium transition-colors ${capsuleType === 'token'
                      ? 'border-Heres-accent bg-Heres-accent/10 text-Heres-accent'
                      : 'border-Heres-border bg-Heres-card/80 text-Heres-white hover:border-Heres-accent/40 hover:bg-Heres-surface/80'}`}
                  >
                    <Coins className="h-5 w-5 shrink-0" />
                    Token
                  </button>
                  <button
                    type="button"
                    disabled
                    title="NFT capsules return in a later release (the lean program distributes fungible assets by proportional share)."
                    className="inline-flex cursor-not-allowed items-center gap-3 rounded-xl border border-Heres-border bg-Heres-card/40 px-5 py-3 text-sm font-medium text-Heres-muted opacity-50"
                  >
                    <ImageIcon className="h-5 w-5 shrink-0" />
                    NFT
                    <span className="rounded bg-Heres-surface/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Soon</span>
                  </button>
                </div>

                {capsuleType === 'token' && (
                  <div className="mt-5 space-y-4 rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                    <div>
                      <label className="mb-2 block text-sm text-Heres-muted">Asset</label>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {SUPPORTED_TOKEN_ASSETS.map((asset) => {
                          const configured = isAssetConfigured(asset.symbol)
                          return (
                            <button
                              key={asset.symbol}
                              type="button"
                              onClick={() => configured && setSelectedTokenAsset(asset.symbol)}
                              disabled={!configured}
                              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                                selectedTokenAsset === asset.symbol
                                  ? 'border-Heres-accent bg-Heres-accent/10 text-Heres-accent'
                                  : configured
                                    ? 'border-Heres-border bg-Heres-card/80 text-Heres-white hover:border-Heres-accent/40'
                                    : 'cursor-not-allowed border-Heres-border/60 bg-Heres-card/40 text-Heres-muted opacity-60'
                              }`}
                            >
                              <p className="text-sm font-semibold">{asset.symbol}</p>
                              <p className="text-xs text-Heres-muted">{asset.label}</p>
                              {!configured && <p className="mt-1 text-[10px] uppercase tracking-wide text-amber-300">Env required</p>}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    {!tokenAssetReady && (
                      <p className="text-xs text-amber-300">
                        {selectedTokenAsset} requires <code className="font-mono">{getAssetMintEnvKey(selectedTokenAsset)}</code> to be set to a valid token mint for the active network.
                      </p>
                    )}
                    <div>
                      <label className="mb-2 block text-sm text-Heres-muted">Total Amount ({tokenAssetUnit})</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={totalAmount}
                        onChange={(e) => setTotalAmount(e.target.value)}
                        placeholder="0.0"
                        className="w-full rounded-xl border border-Heres-border bg-Heres-surface/80 p-3.5 text-sm text-Heres-white placeholder-Heres-muted transition-colors focus:border-Heres-accent/50 focus:outline-none"
                      />
                      <p className="mt-3 text-sm text-Heres-muted">How much {tokenAssetUnit} to lock in the capsule. Each beneficiary receives their share of this.</p>
                    </div>
                  </div>
                )}

                {capsuleType === 'nft' && (
                  <div className="mt-5 rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                    <p className="mb-4 text-sm text-Heres-muted">
                      Choose which NFTs from your wallet to include in this capsule. When conditions are met, they will be transferred to the recipients you set below.
                    </p>
                    {nftListLoading ? (
                      <p className="py-6 text-sm text-Heres-muted">Loading your NFTs...</p>
                    ) : nftList.length === 0 ? (
                      <p className="rounded-xl border border-Heres-border bg-Heres-surface/50 px-4 py-6 text-sm text-Heres-muted">No NFTs found in this wallet.</p>
                    ) : (
                      <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-Heres-border bg-Heres-surface/50 p-3">
                        {nftList.map((nft) => (
                          <label
                            key={nft.mint}
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-Heres-border bg-Heres-card/80 p-3 transition-colors hover:border-Heres-accent/30"
                          >
                            <input
                              type="checkbox"
                              checked={selectedNftMints.includes(nft.mint)}
                              onChange={() => toggleNftSelection(nft.mint)}
                              className="h-4 w-4 rounded border-Heres-border bg-Heres-surface text-Heres-accent focus:ring-Heres-accent"
                            />
                            <span className="min-w-0 flex-1 truncate font-mono text-sm text-Heres-white" title={nft.mint}>
                              {nft.mint.slice(0, 8)}...{nft.mint.slice(-8)}
                            </span>
                            {nft.name && <span className="max-w-[120px] truncate text-sm text-Heres-muted">{nft.name}</span>}
                          </label>
                        ))}
                      </div>
                    )}
                    {selectedNftMints.length > 0 && (
                      <p className="mt-3 text-sm text-Heres-accent">{selectedNftMints.length} NFT(s) selected</p>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-col gap-3 border-t border-Heres-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-Heres-muted">
                    {canCompleteAsset ? 'Asset selection is ready. Continue to recipient setup.' : 'Choose the asset payload before continuing.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpenSection('beneficiaries')}
                    disabled={!canCompleteAsset}
                    className="rounded-xl border border-Heres-accent/30 bg-Heres-accent/10 px-4 py-2.5 text-sm font-medium text-Heres-accent transition hover:bg-Heres-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Continue
                  </button>
                </div>
              </div>
          </ServiceAccordionSection>

          <ServiceAccordionSection
            step="Step 2"
            title="Beneficiary Information and Trigger Conditions"
            description="Enter recipient details, choose timing, and define when the capsule should execute."
            open={openSection === 'beneficiaries'}
            onToggle={() => setOpenSection((prev) => (prev === 'beneficiaries' ? 'intent' : 'beneficiaries'))}
          >
              <div className="space-y-4">
                {capsuleType === null && (
                  <div className="rounded-2xl border border-dashed border-Heres-border bg-Heres-surface/20 p-5 text-sm text-Heres-muted">
                    Choose an asset type in Step 1 first. The beneficiary and trigger inputs will adapt to token or NFT flow automatically.
                  </div>
                )}
                {capsuleType === 'token' && (
                  <div className="space-y-4 rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">Beneficiaries</p>
                      {beneficiaries.length > 1 && (
                        <button type="button" onClick={splitEvenly} className="text-xs font-medium text-Heres-accent hover:underline">
                          Split evenly
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-Heres-muted">Each recipient receives a share of the vault. Shares split evenly by default and must total 100%; edit any field to rebalance.</p>

                    {beneficiaries.map((beneficiary, index) => {
                      const sharePct = parseFloat(beneficiary.amount) || 0
                      const total = parseFloat(totalAmount) || 0
                      const tokenAmount = total > 0 ? (total * sharePct) / 100 : 0
                      return (
                        <div key={beneficiary.id} className="space-y-2">
                          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                            <input
                              type="text"
                              value={beneficiary.address}
                              onChange={(e) => updateBeneficiary(index, 'address', e.target.value.trim())}
                              placeholder="Solana address..."
                              className="w-full min-w-0 flex-1 rounded-xl border border-Heres-border bg-Heres-surface/80 p-4 font-mono text-sm text-Heres-white placeholder-Heres-muted focus:border-Heres-accent/50 focus:outline-none"
                            />
                            <div className="flex flex-shrink-0 items-center gap-2">
                              <div className="flex items-center rounded-xl border border-Heres-border bg-Heres-surface/80 focus-within:border-Heres-accent/50">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={beneficiary.amount}
                                  onChange={(e) => updateBeneficiary(index, 'amount', e.target.value)}
                                  placeholder="0"
                                  aria-label={`Share for beneficiary ${index + 1}`}
                                  className="w-16 bg-transparent p-3 text-right text-sm text-Heres-white placeholder-Heres-muted focus:outline-none"
                                />
                                <span className="pr-3 text-sm text-Heres-muted">%</span>
                              </div>
                              {beneficiaries.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeBeneficiary(index)}
                                  aria-label={`Remove beneficiary ${index + 1}`}
                                  className="rounded-xl border border-Heres-border p-3 text-red-400 transition-colors hover:bg-red-500/10"
                                >
                                  <X className="h-5 w-5" />
                                </button>
                              )}
                            </div>
                          </div>
                          {beneficiary.address && !isValidBeneficiaryAddress(beneficiary) && (
                            <p className="text-xs text-red-400">Invalid Solana address</p>
                          )}
                          {beneficiary.address && sharePct > 0 && total > 0 && (
                            <p className="text-xs text-Heres-muted">
                              ~ <span className="font-semibold text-Heres-accent">{tokenAmount.toFixed(4)} {tokenAssetUnit}</span> ({sharePct}% of {total} {tokenAssetUnit})
                            </p>
                          )}
                        </div>
                      )
                    })}

                    {(() => {
                      const totalShare = Math.round(beneficiaries.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0) * 100) / 100
                      const ok = Math.abs(totalShare - 100) < 0.01
                      return (
                        <div className="flex items-center justify-between rounded-xl border border-Heres-border bg-Heres-surface/50 px-4 py-3 text-sm">
                          <span className="text-Heres-muted">Shares total</span>
                          <span className={ok ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
                            {totalShare}%{ok ? '' : ' (must equal 100%)'}
                          </span>
                        </div>
                      )
                    })()}

                    <button
                      type="button"
                      onClick={addBeneficiary}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-Heres-border py-3 text-sm font-medium text-Heres-accent transition-colors hover:border-Heres-accent/50 hover:bg-Heres-accent/5"
                    >
                      <Plus className="h-5 w-5" />
                      Add Beneficiary
                    </button>
                  </div>
                )}

                {capsuleType === 'nft' && (
                  <div className="space-y-4 rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">NFT Recipients</p>
                    {nftRecipients.map((r, i) => (
                      <div key={i} className="mb-2 flex items-center gap-2">
                        <input
                          type="text"
                          value={r.address}
                          onChange={(e) => setNftRecipientAddress(i, e.target.value.trim())}
                          placeholder="Solana address..."
                          className="flex-1 rounded-xl border border-Heres-border bg-Heres-surface/80 p-3 font-mono text-sm text-Heres-white placeholder-Heres-muted focus:border-Heres-accent/50 focus:outline-none"
                        />
                        {nftRecipients.length > 1 && (
                          <button type="button" onClick={() => removeNftRecipient(i)} className="rounded-lg border border-Heres-border p-2 text-red-400 hover:bg-red-500/10">
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={addNftRecipient} className="mt-2 flex items-center gap-1 text-sm text-Heres-accent hover:underline">
                      <Plus className="h-4 w-4" /> Add recipient
                    </button>

                    {selectedNftMints.length > 0 && (
                      <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-Heres-accent">Which wallet receives which NFT</p>
                        <p className="mb-4 text-sm text-Heres-muted">Select the recipient for each NFT. When the capsule executes, each NFT will be sent to the selected wallet.</p>
                        <div className="space-y-3">
                          {selectedNftMints.map((mint) => (
                            <div key={mint} className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                              <span className="min-w-[120px] truncate font-mono text-sm text-Heres-white sm:w-40" title={mint}>
                                NFT: {mint.slice(0, 8)}...{mint.slice(-8)}
                              </span>
                              <span className="shrink-0 text-Heres-muted">send to</span>
                              <select
                                value={nftAssignments[mint] ?? 0}
                                onChange={(e) => setNftAssignment(mint, Number(e.target.value))}
                                className="min-w-0 flex-1 rounded-lg border border-Heres-border bg-Heres-card/80 px-3 py-2.5 text-sm text-Heres-white focus:border-Heres-accent/50 focus:outline-none"
                              >
                                {nftRecipients.map((r, i) => (
                                  <option key={i} value={i} className="bg-Heres-card text-Heres-white">
                                    {r.address.trim()
                                      ? `Recipient ${i + 1}: ${r.address.slice(0, 6)}...${r.address.slice(-4)}`
                                      : `Recipient ${i + 1} (enter address above)`}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                        {!nftRecipients.some((r) => r.address.trim()) && (
                          <p className="mt-3 text-xs text-Heres-accent">Add at least one recipient address, then choose who receives each NFT here.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {capsuleType !== null && (
                  <div className="rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">Trigger</p>
                    <p className="mb-4 text-sm text-Heres-muted">
                      The capsule fires after this long with no activity, measured from your last on-chain transaction.
                    </p>

                    {supportsMinuteMode && (
                      <div className="mb-3 inline-flex rounded-xl border border-Heres-border bg-Heres-surface/70 p-1">
                        <button
                          type="button"
                          onClick={() => setInactivityUnit('days')}
                          className={`rounded-lg px-4 py-2 text-sm transition ${inactivityUnit === 'days' ? 'bg-Heres-accent/15 text-Heres-accent' : 'text-Heres-muted hover:text-Heres-white'}`}
                        >
                          Days
                        </button>
                        <button
                          type="button"
                          onClick={() => setInactivityUnit('minutes')}
                          className={`rounded-lg px-4 py-2 text-sm transition ${inactivityUnit === 'minutes' ? 'bg-Heres-accent/15 text-Heres-accent' : 'text-Heres-muted hover:text-Heres-white'}`}
                        >
                          Minutes
                        </button>
                      </div>
                    )}

                    <div className="flex items-center rounded-xl border border-Heres-border bg-Heres-surface/80 focus-within:border-Heres-accent/50">
                      <input
                        type="number"
                        inputMode="numeric"
                        value={inactivityDays}
                        onChange={(e) => setInactivityDays(e.target.value)}
                        placeholder={inactivityUnit === 'minutes' ? 'e.g. 5' : 'e.g. 365'}
                        aria-label="Inactivity period"
                        className="w-full bg-transparent p-4 text-Heres-white placeholder-Heres-muted focus:outline-none"
                      />
                      <span className="pr-4 text-sm text-Heres-muted">{inactivityUnit === 'minutes' ? 'minutes' : 'days'}</span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {[
                        { label: '30d', unit: 'days' as const, value: 30 },
                        { label: '90d', unit: 'days' as const, value: 90 },
                        { label: '1y', unit: 'days' as const, value: 365 },
                        ...(supportsMinuteMode ? [
                          { label: '1min', unit: 'minutes' as const, value: 1 },
                          { label: '5min', unit: 'minutes' as const, value: 5 },
                          { label: '10min', unit: 'minutes' as const, value: 10 },
                        ] : []),
                      ].map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => { setInactivityUnit(p.unit); setInactivityDays(String(p.value)) }}
                          className="rounded-lg border border-Heres-accent/30 bg-Heres-accent/10 px-3 py-1 text-xs text-Heres-accent hover:bg-Heres-accent/20"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    <p className="mt-4 text-sm text-Heres-muted">
                      {inactivityDays && parseInt(inactivityDays, 10) > 0 ? (
                        <>
                          After <span className="font-semibold text-Heres-white">{formatInactivityLabel(inactivityDays, inactivityUnit)}</span> of inactivity
                          {approxFireDate ? <> (around <span className="font-semibold text-Heres-white">{approxFireDate}</span> if silent from today)</> : ''}, a fixed <span className="font-semibold text-Heres-white">48h grace</span> applies before assets are released.
                        </>
                      ) : (
                        'Set how long you can be inactive before the capsule fires.'
                      )}
                    </p>

                    <div className="mt-5 border-t border-Heres-border/60 pt-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-Heres-white">Fire on a fixed date <span className="text-Heres-muted">(optional)</span></p>
                        {targetDate && (
                          <button
                            type="button"
                            onClick={() => setTargetDate('')}
                            className="text-xs text-Heres-muted hover:text-Heres-white"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <p className="mb-3 mt-1 text-sm text-Heres-muted">
                        The capsule also fires on this date no matter how active you are. Whichever comes first - inactivity or this date - releases the assets.
                      </p>
                      <div className="flex items-center rounded-xl border border-Heres-border bg-Heres-surface/80 focus-within:border-Heres-accent/50">
                        <input
                          type="date"
                          value={targetDate}
                          min={minTargetDate}
                          onChange={(e) => setTargetDate(e.target.value)}
                          aria-label="Fixed fire date"
                          className="w-full bg-transparent p-4 text-Heres-white placeholder-Heres-muted focus:outline-none [color-scheme:dark]"
                        />
                      </div>
                      {targetDate && (
                        <p className="mt-2 text-sm text-Heres-muted">
                          Fires on <span className="font-semibold text-Heres-white">{new Date(targetDate + 'T00:00:00').toLocaleDateString()}</span> even if you stay active, then a fixed <span className="font-semibold text-Heres-white">48h grace</span> before release.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-Heres-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-Heres-muted">
                    {canCompleteBeneficiaries ? 'Recipients and trigger conditions are ready.' : 'Finish recipient and trigger setup before continuing.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpenSection('intent')}
                    disabled={!canCompleteBeneficiaries}
                    className="rounded-xl border border-Heres-accent/30 bg-Heres-accent/10 px-4 py-2.5 text-sm font-medium text-Heres-accent transition hover:bg-Heres-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Continue
                  </button>
                </div>
              </div>
          </ServiceAccordionSection>

          <ServiceAccordionSection
            step="Step 3"
            title="Declare Your Intent"
            description="Describe your inheritance intent and executor notes. This is a support instruction, not a formal legal will."
            open={openSection === 'intent'}
            onToggle={() => setOpenSection((prev) => (prev === 'intent' ? 'review' : 'intent'))}
          >
              <div className="space-y-4">
                {capsuleType === null && (
                  <div className="rounded-2xl border border-dashed border-Heres-border bg-Heres-surface/20 p-5 text-sm text-Heres-muted">
                    Select an asset type and configure the recipient flow first, then write the intent statement that accompanies the capsule.
                  </div>
                )}
                <div className="rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">Encrypted Delivery</p>
                  <p className="mb-4 text-sm text-Heres-white">Choose who receives the encrypted intent statement after execution is confirmed.</p>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-sm text-Heres-muted">Representative Email</label>
                      <input
                        type="email"
                        value={creEmail}
                        onChange={(e) => setCreEmail(e.target.value)}
                        placeholder="executor@example.com"
                        className="w-full rounded-xl border border-Heres-border bg-Heres-surface/80 p-4 text-Heres-white placeholder-Heres-muted focus:border-Heres-accent/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-Heres-muted">Access Code</label>
                      <input
                        type="password"
                        value={creUnlockCode}
                        onChange={(e) => setCreUnlockCode(e.target.value)}
                        placeholder="At least 6 characters"
                        className="w-full rounded-xl border border-Heres-border bg-Heres-surface/80 p-4 text-Heres-white placeholder-Heres-muted focus:border-Heres-accent/50 focus:outline-none"
                      />
                      <p className="mt-2 text-xs text-Heres-muted">This code should be shared offline with the representative. The intent statement is encrypted in-browser before upload.</p>
                    </div>
                    <label className="flex items-start gap-3 rounded-xl border border-Heres-border bg-Heres-card/40 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={creReminderEnabled}
                        onChange={(e) => setCreReminderEnabled(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-Heres-border bg-Heres-surface text-Heres-accent focus:ring-Heres-accent/40"
                      />
                      <span className="space-y-1">
                        <span className="block text-sm font-medium text-Heres-white">Send recurring reminder emails before execution</span>
                        <span className="block text-xs text-Heres-muted">
                          Heres will use Chainlink CRE to remind the representative about this capsule on a monthly cadence until the capsule is executed or deactivated.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>

                <textarea
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder="If I am inactive for one year, transfer my assets to my family, and delegate DAO permissions to my co-founder."
                  className="h-32 w-full resize-none rounded-xl border border-Heres-border bg-Heres-surface/80 p-4 text-sm leading-6 text-Heres-white placeholder-Heres-muted transition-colors focus:border-Heres-accent/50 focus:outline-none"
                />
                <p className="text-xs text-amber-400">Do not put private keys, seed phrases, or master passwords in the intent statement.</p>

                {error && (
                  <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-400">
                    Error: {error}
                  </div>
                )}
                {txHash && (
                  <div className="rounded-xl border border-Heres-accent/50 bg-Heres-accent/10 p-4 text-sm text-Heres-accent">
                    Capsule created. Transaction: {txHash}
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-Heres-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-Heres-muted">
                    {canCompleteIntent ? 'Intent package is ready for final review.' : 'Add the intent statement, representative email, and access code before continuing.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpenSection('review')}
                    disabled={!canCompleteIntent}
                    className="rounded-xl border border-Heres-accent/30 bg-Heres-accent/10 px-4 py-2.5 text-sm font-medium text-Heres-accent transition hover:bg-Heres-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Continue
                  </button>
                </div>
              </div>
          </ServiceAccordionSection>

          <ServiceAccordionSection
            step="Step 4"
            title="Review & Create"
            description="Check readiness, privacy tier, fees, and then create the capsule."
            open={openSection === 'review'}
            onToggle={() => setOpenSection((prev) => (prev === 'review' ? 'intent' : 'review'))}
          >
              <div className="space-y-4">
                {capsuleType === null && (
                  <div className="rounded-2xl border border-dashed border-Heres-border bg-Heres-surface/20 p-5 text-sm text-Heres-muted">
                    Review becomes actionable once the earlier steps are complete. Use it as the final launch point before creating the capsule.
                  </div>
                )}
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                  <div className="space-y-3.5">
                    <div className="rounded-xl border border-Heres-accent/30 bg-Heres-accent/10 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <Shield className="h-4 w-4 text-Heres-accent" />
                        <span className="text-xs font-bold uppercase tracking-wider text-Heres-accent">Privacy Tier: PER (TEE)</span>
                      </div>
                      <p className="text-xs text-Heres-muted">
                        This capsule uses MagicBlock&apos;s Private Ephemeral Rollup so intent and trigger execution can remain confidential until conditions are met.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">Readiness Checklist</p>
                      <div className="mt-4 space-y-3 text-sm">
                        {[
                          { label: 'Asset selected', ok: hasAssetSelection },
                          { label: 'Beneficiaries and timing configured', ok: hasBeneficiaryDetails },
                          { label: 'Intent statement written', ok: hasIntentDetails },
                          { label: 'Representative email valid', ok: isValidEmail(creEmail) },
                        ].map((item) => (
                          <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl border border-Heres-border bg-Heres-card/50 px-4 py-3">
                            <span className="text-Heres-white">{item.label}</span>
                            <span className={`text-xs font-semibold uppercase tracking-[0.2em] ${item.ok ? 'text-emerald-400' : 'text-Heres-muted'}`}>
                              {item.ok ? 'Ready' : 'Pending'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {existingCapsule && (
                      <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
                        An active capsule already exists for this wallet. Creating a new one may require deactivation or execution of the current capsule first.
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-Heres-border bg-Heres-surface/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">Creation Summary</p>
                    <div className="mt-4 space-y-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-Heres-muted">Creation Fee</span>
                        <span className="font-semibold text-Heres-accent">{PLATFORM_FEE.CREATION_FEE_SOL} SOL</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-Heres-muted">Execution Fee</span>
                        <span className="font-semibold text-Heres-white">{PLATFORM_FEE.EXECUTION_FEE_BPS / 100}%</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-Heres-muted">Representative</span>
                        <span className="max-w-[180px] truncate font-medium text-Heres-white">{creEmail || 'Pending'}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-Heres-muted">Reminder Emails</span>
                        <span className={`font-medium ${creReminderEnabled ? 'text-Heres-accent' : 'text-Heres-muted'}`}>
                          {creReminderEnabled ? 'Enabled' : 'Off'}
                        </span>
                      </div>
                      <div className="border-t border-Heres-border pt-4">
                        {error && (
                          <div className="mb-3 rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-400">
                            {error}
                          </div>
                        )}
                        <button onClick={simulateExecution} className="btn-secondary mb-3 flex w-full items-center justify-center gap-2 py-3.5">
                          <Eye className="h-5 w-5" />
                          Simulate Execution
                        </button>
                        <button
                          type="button"
                          onClick={handleCreate}
                          disabled={!isCreateReady}
                          className="btn-primary w-full py-3.5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isPending ? (currentStep || 'Creating capsule...') : 'Create Capsule'}
                        </button>
                        <p className="mt-3 text-xs text-Heres-muted">
                          Final creation is enabled after all steps above are complete and your wallet can sign the encrypted payload.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
          </ServiceAccordionSection>

          <section className="card-Heres p-5 sm:p-5">
            <h2 className="text-xl font-semibold text-Heres-white">FAQs</h2>
            <div className="mt-4 space-y-2.5">
              {CREATE_FAQS.map((faq) => (
                <div key={faq.key} className="overflow-hidden rounded-xl border border-Heres-border">
                  <button
                    type="button"
                    onClick={() => setOpenFaq((prev) => (prev === faq.key ? null : faq.key))}
                    className="flex w-full items-center justify-between gap-4 bg-Heres-card/50 px-4 py-4 text-left"
                  >
                    <span className="text-base font-medium text-Heres-white">{faq.question}</span>
                    {isFaqOpen(faq.key) ? <ChevronUp className="h-5 w-5 text-Heres-muted" /> : <ChevronDown className="h-5 w-5 text-Heres-muted" />}
                  </button>
                  {isFaqOpen(faq.key) && (
                    <div className="border-t border-Heres-border bg-Heres-surface/20 px-4 py-4 text-sm text-Heres-muted">
                      {faq.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-5">
              <p className="text-lg font-semibold text-Heres-white">Haven&apos;t Found Your Question?</p>
              <p className="mt-3 text-sm text-Heres-muted">Reach out through the official Heres community channels and support inbox if you need help finalizing your capsule flow.</p>
            </div>
          </section>

          {showSimulation && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
              <div className="card-Heres max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-8">
                <div className="mb-6 flex items-center justify-between">
                  <h3 className="text-xl font-bold text-Heres-white">Execution Simulation</h3>
                  <button onClick={() => setShowSimulation(false)} className="text-Heres-muted hover:text-Heres-white">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                    <p className="mb-1 text-xs text-Heres-accent">Intent</p>
                    <p className="text-Heres-white">{intent || 'No intent specified'}</p>
                  </div>
                  {capsuleType === 'token' && (
                    <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                      <p className="mb-2 text-xs text-Heres-accent">Beneficiaries</p>
                      <div className="space-y-2">
                        {beneficiaries.map((b) => (
                          <div key={b.id} className="flex justify-between gap-3 rounded-lg bg-Heres-card/80 p-2">
                            <p className="max-w-[200px] truncate font-mono text-sm text-Heres-white">
                              {b.address || 'Not set'}
                            </p>
                            <p className="text-sm font-semibold text-Heres-accent">{b.amount || '0'}%</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {capsuleType === 'nft' && (
                    <>
                      <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                        <p className="mb-2 text-xs text-Heres-accent">Selected NFTs</p>
                        <div className="space-y-1">
                          {selectedNftMints.map((mint) => (
                            <p key={mint} className="truncate font-mono text-sm text-Heres-white">{mint.slice(0, 12)}...{mint.slice(-8)}</p>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                        <p className="mb-2 text-xs text-Heres-accent">Recipients & assignment</p>
                        <div className="space-y-2">
                          {selectedNftMints.map((mint) => {
                            const idx = nftAssignments[mint] ?? 0
                            const addr = nftRecipients[idx]?.address ?? ''
                            return (
                              <div key={mint} className="flex items-center justify-between rounded-lg bg-Heres-card/80 p-2 text-sm">
                                <span className="max-w-[140px] truncate font-mono text-Heres-muted">{mint.slice(0, 6)}...{mint.slice(-6)}</span>
                                <span className="text-Heres-muted">→ send to</span>
                                <span className="max-w-[160px] truncate font-mono text-Heres-white">{addr ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : 'Not set'}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </>
                  )}
                  <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                    <p className="mb-1 text-xs text-Heres-accent">Trigger</p>
                    <p className="text-Heres-white">
                      After {formatInactivityLabel(inactivityDays, inactivityUnit) || '0 days'} of inactivity, a fixed 48h grace applies before assets are released.
                    </p>
                  </div>
                  <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                    <p className="mb-1 text-xs text-Heres-accent">Intent Statement Delivery</p>
                    <p className="text-Heres-white">An encrypted intent statement package will be sent to {creEmail || 'representative email'} when execution is confirmed.</p>
                  </div>
                  <div className="rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                    <p className="mb-1 text-xs text-Heres-accent">Reminder Cadence</p>
                    <p className="text-Heres-white">
                      {creReminderEnabled
                        ? `Monthly reminder emails will continue to ${creEmail || 'the representative'} until the capsule executes or is deactivated.`
                        : 'Recurring reminder emails are disabled for this capsule.'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-Heres-accent/30 bg-Heres-accent/10 p-4">
                    <p className="flex items-center gap-2 font-semibold text-Heres-accent">
                      <CheckCircle className="h-5 w-5" />
                      Execution would succeed
                    </p>
                    <p className="mt-1 text-sm text-Heres-muted">All conditions met. Capsule would execute automatically.</p>
                  </div>
                </div>
                <button onClick={() => setShowSimulation(false)} className="btn-primary mt-6 w-full py-3">
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

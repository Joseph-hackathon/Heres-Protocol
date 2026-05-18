'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import dynamic from 'next/dynamic'
import { Clock, User, Shield, Eye, Plus, X, CheckCircle, ChevronDown, ChevronUp, Coins, ImageIcon, ExternalLink } from 'lucide-react'

// Dynamic import to prevent hydration errors
const WalletMultiButton = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false }
)
import { createCapsule, getCapsule, delegateCapsule, scheduleExecuteIntent, registerCapsuleOwnerForAutomation } from '@/lib/solana'
import { getCapsulePDA, getCapsuleVaultPDA } from '@/lib/program'
import { Beneficiary } from '@/types'
import {
  DEFAULT_VALUES,
  STORAGE_KEYS,
  SOLANA_CONFIG,
  PLATFORM_FEE,
  MAGICBLOCK_ER,
  MAX_CAPSULE_MODIFICATIONS,
  getAssetMintEnvKey,
} from '@/constants'
import { encodeIntentData, daysToSeconds } from '@/utils/intent'
import { getAssetConfig, getAssetMintPublicKey, isAssetConfigured, SUPPORTED_TOKEN_ASSETS, SupportedAssetSymbol } from '@/lib/assets'
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
import { PublicKey } from '@solana/web3.js'
import { SectionEyebrow, ServiceAccordionSection, ServiceMetaCard, ServicePageHeader } from '@/components/ui/service-page'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

export type CapsuleAssetType = 'token' | 'nft' | null
type InactivityUnit = 'days' | 'minutes'

export type NftItem = { mint: string; name?: string; symbol?: string; imageUri?: string }

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
  const [completedSections, setCompletedSections] = useState({
    asset: false,
    beneficiaries: false,
    intent: false,
  })
  const [intent, setIntent] = useState('')
  const [capsuleType, setCapsuleType] = useState<CapsuleAssetType>(null)
  const [selectedTokenAsset, setSelectedTokenAsset] = useState<SupportedAssetSymbol>('SOL')
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([
    { chain: 'solana', address: '', amount: '', amountType: 'fixed', destinationChainSelector: '' }
  ])
  const [totalAmount, setTotalAmount] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [inactivityDays, setInactivityDays] = useState('')
  const [inactivityUnit, setInactivityUnit] = useState<InactivityUnit>('days')
  const [delayDays, setDelayDays] = useState<string>(DEFAULT_VALUES.DELAY_DAYS)
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

  // Fetch wallet NFTs when NFT path is selected (Alchemy DAS first, Helius fallback, else RPC)
  useEffect(() => {
    if (capsuleType !== 'nft' || !publicKey || !connected) return
    let cancelled = false
    setNftListLoading(true)

    const run = async () => {
      if (SOLANA_CONFIG.ALCHEMY_API_KEY || SOLANA_CONFIG.HELIUS_API_KEY) {
        try {
          const res = await fetch(`/api/assets/nfts?wallet=${encodeURIComponent(publicKey.toBase58())}`, {
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

  const addBeneficiary = () => {
    setBeneficiaries([...beneficiaries, { chain: 'solana', address: '', amount: '', amountType: 'fixed', destinationChainSelector: '' }])
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

  const syncTargetDateFromDays = (rawValue: string) => {
    const days = parseInt(rawValue, 10)
    if (Number.isFinite(days) && days > 0) {
      const d = new Date()
      d.setDate(d.getDate() + days)
      setTargetDate(d.toISOString().split('T')[0])
    } else {
      setTargetDate('')
    }
  }

  const removeBeneficiary = (index: number) => {
    if (beneficiaries.length > 1) {
      setBeneficiaries(beneficiaries.filter((_, i) => i !== index))
    }
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

  const updateBeneficiary = (
    index: number,
    field: keyof Beneficiary,
    value: string | 'fixed' | 'percentage' | 'solana' | 'evm' | 'stellar'
  ) => {
    const updated = [...beneficiaries]
    const oldBeneficiary = updated[index]
    updated[index] = { ...updated[index], [field]: value }

    // Convert fixed to percentage when switching to percentage
    if (field === 'amountType' && value === 'percentage' && totalAmount) {
      if (oldBeneficiary.amountType === 'fixed' && oldBeneficiary.amount) {
        const fixedAmount = parseFloat(oldBeneficiary.amount)
        const total = parseFloat(totalAmount)
        if (total > 0) {
          updated[index].amount = ((fixedAmount / total) * 100).toFixed(2)
        }
      }
    }

    // Convert percentage to fixed when switching to fixed
    if (field === 'amountType' && value === 'fixed' && totalAmount) {
      if (oldBeneficiary.amountType === 'percentage' && oldBeneficiary.amount) {
        const percentage = parseFloat(oldBeneficiary.amount)
        const total = parseFloat(totalAmount)
        if (total > 0) {
          updated[index].amount = ((total * percentage) / 100).toFixed(6)
        }
      }
    }

    // Update percentage amounts when amount changes and type is percentage
    if (field === 'amount' && updated[index].amountType === 'percentage' && totalAmount) {
      const percentage = parseFloat(value as string)
      const total = parseFloat(totalAmount)
      if (total > 0 && !isNaN(percentage)) {
        // Keep percentage, but validate it's between 0-100
        if (percentage > 100) {
          updated[index].amount = '100'
        } else if (percentage < 0) {
          updated[index].amount = '0'
        }
      }
    }

    setBeneficiaries(updated)
  }

  const validateBeneficiaries = (): boolean => {
    if (!tokenAssetReady) {
      alert(`${selectedTokenAsset} mint is not configured. Set ${getAssetMintEnvKey(selectedTokenAsset)} first.`)
      return false
    }

    if (!validateBeneficiaryAddresses(beneficiaries)) {
      alert('Please enter valid beneficiary addresses (Solana: base58, EVM: 0x...).')
      return false
    }

    if (!validateBeneficiaryAmounts(beneficiaries)) {
      alert('Please enter valid amounts for all beneficiaries.')
      return false
    }

    if (!validatePercentageTotals(beneficiaries)) {
      const percentageBeneficiaries = beneficiaries.filter(b => b.amountType === 'percentage')
      const totalPercentage = percentageBeneficiaries.reduce(
        (sum, b) => sum + parseFloat(b.amount || '0'),
        0
      )
      alert(`Total percentage must equal 100%. Current total: ${totalPercentage.toFixed(2)}%`)
      return false
    }

    return true
  }

  const handleCreate = async () => {
    if (!connected || !publicKey) {
      alert('Please connect your Solana wallet')
      return
    }

    // Check modification limit (3 per wallet)
    const countKey = STORAGE_KEYS.CAPSULE_MODIFY_COUNT(publicKey.toBase58())
    const currentCount = parseInt(localStorage.getItem(countKey) || '0', 10)
    if (currentCount >= MAX_CAPSULE_MODIFICATIONS) {
      alert(`You have reached the maximum number of capsule modifications (${MAX_CAPSULE_MODIFICATIONS}) for this wallet.`)
      return
    }

    if (capsuleType === 'token' && !validateBeneficiaries()) return
    if (capsuleType === 'nft') {
      const validRecipients = nftRecipients.filter((r) => r.address.trim())
      if (selectedNftMints.length === 0) {
        alert('Please select at least one NFT.')
        return
      }
      if (validRecipients.length === 0) {
        alert('Please add at least one recipient address.')
        return
      }
      for (const addr of validRecipients) {
        if (!isValidSolanaAddress(addr.address)) {
          alert('Please enter a valid Solana address for all recipients.')
          return
        }
      }
    }

    if (!intent.trim()) {
      alert('Please enter an intent statement')
      return
    }

    if (!inactivityDays || parseInt(inactivityDays) <= 0) {
      alert('Please select a target date or specify a valid inactivity period')
      return
    }

    if (!wallet.signMessage) {
      alert('This wallet does not support message signing required for Intent Statement email delivery.')
      return
    }
    if (!isValidEmail(creEmail)) {
      alert('Please enter a valid representative email address.')
      return
    }
    if (creUnlockCode.trim().length < 6) {
      alert('Please set an access code with at least 6 characters.')
      return
    }

    const signMessage = wallet.signMessage

    setIsPending(true)
    setError(null)

    try {
      const inactivityValueNum = parseInt(inactivityDays, 10)
      const selectedMint = capsuleType === 'token' ? getAssetMintPublicKey(selectedTokenAsset) : undefined
      let intentData: Uint8Array
      let creMeta: {
        enabled: true
        secretRef: string
        secretHash: string
        recipientEmailHash: string
        deliveryChannel: 'email'
      }

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
      creMeta = {
        enabled: true,
        secretRef: secretJson.secretRef,
        secretHash: secretJson.secretHash,
        recipientEmailHash: secretJson.recipientEmailHash || recipientEmailHash,
        deliveryChannel: 'email',
      }

      if (capsuleType === 'nft') {
        const validRecipients = nftRecipients.filter((r) => r.address.trim()).map((r) => r.address)
        const payload = {
          type: 'nft',
          intent,
          nftMints: selectedNftMints,
          nftRecipients: validRecipients,
          nftAssignments,
          inactivityDays: inactivityUnit === 'days' ? inactivityValueNum : 0,
          inactivityValue: inactivityValueNum,
          inactivityUnit,
          delayDays: parseInt(delayDays),
          assetSymbol: selectedTokenAsset,
          assetMint: tokenAssetConfig.mint,
          cre: creMeta,
        }
        intentData = new TextEncoder().encode(JSON.stringify(payload))
      } else {
        intentData = encodeIntentData({
          intent,
          beneficiaries,
          totalAmount,
          assetSymbol: selectedTokenAsset,
          assetMint: tokenAssetConfig.mint,
          inactivityDays: inactivityUnit === 'days' ? inactivityValueNum : 0,
          inactivityValue: inactivityValueNum,
          inactivityUnit,
          delayDays: parseInt(delayDays),
          cre: creMeta,
        })
      }

      const inactivityPeriodSeconds = inactivityUnit === 'minutes'
        ? inactivityValueNum * 60
        : daysToSeconds(inactivityValueNum)

      // Check if there's an existing capsule - if so, recreate it instead of creating new
      let hash: string
      if (publicKey) {
        const existingCapsule = await getCapsule(publicKey)

        if (existingCapsule && !existingCapsule.isActive && existingCapsule.executedAt) {
          // Executed capsule — recreate it
          const { recreateCapsule } = await import('@/lib/solana')
          hash = await recreateCapsule(
            wallet as any,
            inactivityPeriodSeconds,
            intentData,
            selectedMint
          )
        } else if (existingCapsule && existingCapsule.isActive) {
          // Active capsule exists — cannot create new one (on-chain constraint)
          throw new Error('You already have an active capsule. It must be executed or cancelled before creating a new one. Visit /capsules to view it.')
        } else {
          hash = await createCapsule(
            wallet as any,
            inactivityPeriodSeconds,
            intentData,
            selectedMint
          )
        }
      } else {
        hash = await createCapsule(
          wallet as any,
          inactivityPeriodSeconds,
          intentData,
          selectedMint
        )
      }

      setTxHash(hash)
      console.log('[Step 1/3] Capsule created. Tx:', hash)

      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      const automationIssues: string[] = []
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
          automationIssues.push('owner registration for crank discovery')
        }
      }

      let delegatedToEr = false

      // ===== Step 2: Delegate to ER =====
      setCurrentStep('Delegating to ER...')
      console.log('[Step 2/3] Delegating capsule to active ER validator...')
      for (let attempt = 0; attempt < 2 && !delegatedToEr; attempt++) {
        try {
          const delegateTx = await delegateCapsule(wallet as any, new PublicKey(MAGICBLOCK_ER.ACTIVE_VALIDATOR))
          delegatedToEr = true
          console.log('[Step 2/3] Delegation successful. Tx:', delegateTx)
        } catch (delegateErr: any) {
          console.warn(`[Step 2/3] Delegation failed (attempt ${attempt + 1}/2):`, delegateErr?.message)
          if (attempt < 1) await sleep(2000)
        }
      }
      if (!delegatedToEr) {
        automationIssues.push('ER delegation')
      }

      let erSynced = false
      if (delegatedToEr && publicKey) {
        setCurrentStep('Waiting for ER sync...')
        for (let attempt = 0; attempt < 8 && !erSynced; attempt++) {
          try {
            const syncedCapsule = await getCapsule(publicKey)
            const accountOwner = (syncedCapsule as any)?.accountOwner as PublicKey | undefined
            if (accountOwner?.equals?.(new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID))) {
              erSynced = true
              break
            }
          } catch {
            // Retry until timeout.
          }
          await sleep(2000)
        }

        if (!erSynced) {
          automationIssues.push('ER sync before crank scheduling')
        }
      }

      // ===== Step 3: Schedule Crank on ER =====
      if (delegatedToEr && erSynced && publicKey) {
        setCurrentStep('Scheduling crank...')
        console.log('[Step 3/3] Scheduling crank on ER...')
        let scheduled = false
        for (let attempt = 0; attempt < 3 && !scheduled; attempt++) {
          try {
            const scheduleTx = await scheduleExecuteIntent(wallet as any, publicKey)
            scheduled = true
            console.log('[Step 3/3] Crank scheduled. Tx:', scheduleTx)
          } catch (scheduleErr: any) {
            console.warn(`[Step 3/3] Crank scheduling failed (attempt ${attempt + 1}/3):`, scheduleErr?.message)
            if (attempt < 2) await sleep(2500 * (attempt + 1))
          }
        }

        if (!scheduled) {
          automationIssues.push('ER crank scheduling')
        }
      }

      setCurrentStep(null)

      if (automationIssues.length) {
        alert(
          `Capsule created, but automatic execution setup is incomplete.\n\nMissing or failed: ${automationIssues.join(', ')}.\n\nExternal cron may still pick it up if registry is configured, but please confirm automation before relying on it.`
        )
      }

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
              alert('Capsule created successfully!')
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
      alert(`Error: ${errorMessage}`)
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
  const currentStepIndex = !completedSections.asset
    ? 1
    : !completedSections.beneficiaries
      ? 2
      : !completedSections.intent
        ? 3
        : 4
  const currentStepMeta = !completedSections.asset
    ? 'Choose what goes into the capsule first.'
    : !completedSections.beneficiaries
      ? 'Set recipients, timing, and secure delivery.'
      : !completedSections.intent
        ? 'Write the instruction beneficiaries will receive.'
        : 'Review the final payload and create the capsule.'
  const isFaqOpen = (key: string) => openFaq === key

  useEffect(() => {
    setCompletedSections((prev) => ({
      asset: canCompleteAsset ? prev.asset : false,
      beneficiaries: canCompleteBeneficiaries && canCompleteAsset ? prev.beneficiaries : false,
      intent: canCompleteIntent && canCompleteBeneficiaries && canCompleteAsset ? prev.intent : false,
    }))
  }, [canCompleteAsset, canCompleteBeneficiaries, canCompleteIntent])

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
                (step.key === 'asset' && completedSections.asset) ||
                (step.key === 'beneficiary' && completedSections.beneficiaries) ||
                (step.key === 'intent' && completedSections.intent) ||
                (step.key === 'review' && isCreateReady)
              )
              const isCurrent = (
                (step.key === 'asset' && !completedSections.asset) ||
                (step.key === 'beneficiary' && completedSections.asset && !completedSections.beneficiaries) ||
                (step.key === 'intent' && completedSections.beneficiaries && !completedSections.intent) ||
                (step.key === 'review' && completedSections.intent)
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
                    onClick={() => {
                      setCapsuleType('token')
                      setCompletedSections((prev) => ({ ...prev, asset: false, beneficiaries: false, intent: false }))
                    }}
                    className={`inline-flex items-center gap-3 rounded-xl border px-5 py-3 text-sm font-medium transition-colors ${capsuleType === 'token'
                      ? 'border-Heres-accent bg-Heres-accent/10 text-Heres-accent'
                      : 'border-Heres-border bg-Heres-card/80 text-Heres-white hover:border-Heres-accent/40 hover:bg-Heres-surface/80'}`}
                  >
                    <Coins className="h-5 w-5 shrink-0" />
                    Token
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCapsuleType('nft')
                      setCompletedSections((prev) => ({ ...prev, asset: false, beneficiaries: false, intent: false }))
                    }}
                    className={`inline-flex items-center gap-3 rounded-xl border px-5 py-3 text-sm font-medium transition-colors ${capsuleType === 'nft'
                      ? 'border-Heres-accent bg-Heres-accent/10 text-Heres-accent'
                      : 'border-Heres-border bg-Heres-card/80 text-Heres-white hover:border-Heres-accent/40 hover:bg-Heres-surface/80'}`}
                  >
                    <ImageIcon className="h-5 w-5 shrink-0" />
                    NFT
                    <ExternalLink className="h-4 w-4 shrink-0 opacity-70" />
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
                        value={totalAmount}
                        onChange={(e) => {
                          const value = e.target.value
                          setTotalAmount(value)
                          if (value && beneficiaries.some((b) => b.amountType === 'percentage')) {
                            const total = parseFloat(value)
                            if (total > 0) {
                              const updated = beneficiaries.map((b) => {
                                if (b.amountType === 'percentage' && b.amount) {
                                  const percentage = parseFloat(b.amount)
                                  return { ...b, amount: ((total * percentage) / 100).toFixed(6) }
                                }
                                return b
                              })
                              setBeneficiaries(updated)
                            }
                          }
                        }}
                        placeholder="0.0"
                        step="0.001"
                        className="w-full rounded-xl border border-Heres-border bg-Heres-surface/80 p-3.5 text-sm text-Heres-white placeholder-Heres-muted transition-colors focus:border-Heres-accent/50 focus:outline-none"
                      />
                      <p className="mt-3 text-sm text-Heres-muted">Amount to be distributed in {tokenAssetUnit}. Percentages are calculated automatically.</p>
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
                    onClick={() => {
                      setCompletedSections((prev) => ({ ...prev, asset: true }))
                      setOpenSection('beneficiaries')
                    }}
                    disabled={!canCompleteAsset}
                    className="rounded-xl border border-Heres-accent/30 bg-Heres-accent/10 px-4 py-2.5 text-sm font-medium text-Heres-accent transition hover:bg-Heres-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Complete Step 1
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
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">Token Beneficiaries</p>
                    {beneficiaries.map((beneficiary, index) => (
                      <div key={index} className="space-y-2">
                        <div className="flex flex-col items-start gap-3 sm:flex-row">
                          <div className="w-full min-w-0 flex-1">
                            <div className="mb-2 inline-flex h-[36px] overflow-hidden rounded-xl border border-Heres-border bg-Heres-surface/80">
                              <button
                                type="button"
                                onClick={() => updateBeneficiary(index, 'chain', 'solana')}
                                className={`h-full px-3 text-xs font-semibold transition-colors ${beneficiary.chain !== 'evm' ? 'bg-Heres-accent text-Heres-bg' : 'text-Heres-muted hover:text-Heres-white'}`}
                              >
                                {tokenAssetUnit}
                              </button>
                              <button
                                type="button"
                                onClick={() => updateBeneficiary(index, 'chain', 'evm')}
                                className={`h-full px-3 text-xs font-semibold transition-colors ${beneficiary.chain === 'evm' ? 'bg-Heres-accent text-Heres-bg' : 'text-Heres-muted hover:text-Heres-white'}`}
                              >
                                EVM
                              </button>
                            </div>
                            <input
                              type="text"
                              value={beneficiary.address}
                              onChange={(e) => updateBeneficiary(index, 'address', e.target.value.trim())}
                              placeholder={beneficiary.chain === 'evm' ? '0xEvmAddress...' : 'Solana address...'}
                              className="w-full rounded-xl border border-Heres-border bg-Heres-surface/80 p-4 font-mono text-sm text-Heres-white placeholder-Heres-muted focus:border-Heres-accent/50 focus:outline-none"
                            />
                            {beneficiary.chain === 'evm' && (
                              <input
                                type="text"
                                value={beneficiary.destinationChainSelector || ''}
                                onChange={(e) => updateBeneficiary(index, 'destinationChainSelector', e.target.value.trim())}
                                placeholder="Destination chain selector (default: Ethereum Sepolia)"
                                className="mt-2 w-full rounded-xl border border-Heres-border bg-Heres-surface/80 p-3 font-mono text-xs text-Heres-white placeholder-Heres-muted focus:border-Heres-accent/50 focus:outline-none"
                              />
                            )}
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-2">
                            <input
                              type="number"
                              value={beneficiary.amount}
                              onChange={(e) => updateBeneficiary(index, 'amount', e.target.value)}
                              placeholder={beneficiary.amountType === 'percentage' ? '0%' : '0.0'}
                              step={beneficiary.amountType === 'percentage' ? '0.1' : '0.001'}
                              className="w-24 rounded-xl border border-Heres-border bg-Heres-surface/80 p-3 text-sm text-Heres-white placeholder-Heres-muted focus:border-Heres-accent/50 focus:outline-none"
                            />
                            <div className="flex h-[46px] overflow-hidden rounded-xl border border-Heres-border bg-Heres-surface/80">
                              <button
                                type="button"
                                onClick={() => updateBeneficiary(index, 'amountType', 'fixed')}
                                className={`h-full px-3 text-xs font-semibold transition-colors ${beneficiary.amountType === 'fixed' ? 'bg-Heres-accent text-Heres-bg' : 'text-Heres-muted hover:text-Heres-white'}`}
                              >
                                {tokenAssetUnit}
                              </button>
                              <button
                                type="button"
                                onClick={() => updateBeneficiary(index, 'amountType', 'percentage')}
                                className={`h-full px-3 text-xs font-semibold transition-colors ${beneficiary.amountType === 'percentage' ? 'bg-Heres-accent text-Heres-bg' : 'text-Heres-muted hover:text-Heres-white'}`}
                              >
                                %
                              </button>
                            </div>
                            {beneficiaries.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeBeneficiary(index)}
                                className="rounded-xl border border-Heres-border p-3 text-red-400 transition-colors hover:bg-red-500/10"
                              >
                                <X className="h-5 w-5" />
                              </button>
                            )}
                          </div>
                        </div>
                        {beneficiary.address && !isValidBeneficiaryAddress(beneficiary) && (
                          <p className="text-xs text-red-400">
                            {beneficiary.chain === 'evm' ? 'Invalid EVM address (0x...)' : 'Invalid Solana address'}
                          </p>
                        )}
                        {beneficiary.address && beneficiary.amount && totalAmount && (
                          <div className="mt-2 rounded-xl border border-Heres-border bg-Heres-surface/50 p-3">
                            {(() => {
                              const total = parseFloat(totalAmount)
                              let actualAmount = 0
                              let percentage = 0
                              if (beneficiary.amountType === 'fixed') {
                                actualAmount = parseFloat(beneficiary.amount) || 0
                                percentage = total > 0 ? (actualAmount / total) * 100 : 0
                              } else {
                                percentage = parseFloat(beneficiary.amount) || 0
                                actualAmount = total > 0 ? (total * percentage) / 100 : 0
                              }
                              return (
                                <p className="text-sm text-Heres-muted">
                                  <span className="font-semibold text-Heres-accent">{actualAmount.toFixed(6)} {tokenAssetUnit}</span>{' '}
                                  (<span className="font-semibold text-Heres-accent">{percentage.toFixed(2)}%</span>) of{' '}
                                  <span className="font-semibold text-Heres-white">{total} {tokenAssetUnit}</span>
                                </p>
                              )
                            })()}
                          </div>
                        )}
                      </div>
                    ))}
                    {totalAmount && beneficiaries.some((b) => b.address && b.amount) && (
                      <div className="mt-4 space-y-2 rounded-xl border border-Heres-border bg-Heres-surface/50 p-4">
                        {(() => {
                          const total = parseFloat(totalAmount) || 0
                          let totalDistributed = 0
                          beneficiaries.forEach((b) => {
                            if (b.address && b.amount) {
                              const amt = b.amountType === 'fixed' ? parseFloat(b.amount) || 0 : (total * (parseFloat(b.amount) || 0)) / 100
                              totalDistributed += amt
                            }
                          })
                          const remaining = total - totalDistributed
                          const isExceeded = totalDistributed > total
                          return (
                            <>
                              <div className="flex justify-between text-sm">
                                <span className="text-Heres-muted">Total to distribute</span>
                                <span className={isExceeded ? 'font-semibold text-red-400' : 'font-semibold text-Heres-accent'}>
                                  {totalDistributed.toFixed(6)} / {total} {tokenAssetUnit}
                                </span>
                              </div>
                              {isExceeded && <p className="text-sm text-red-400">Distribution exceeds total by {Math.abs(remaining).toFixed(6)} {tokenAssetUnit}</p>}
                              {!isExceeded && remaining > 0 && <p className="text-sm text-Heres-muted">Remaining: {remaining.toFixed(6)} {tokenAssetUnit}</p>}
                              {!isExceeded && remaining === 0 && <p className="text-sm text-Heres-accent">All tokens distributed</p>}
                            </>
                          )
                        })()}
                      </div>
                    )}
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
                    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">Trigger Conditions</p>
                    <div className="grid gap-6 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm text-Heres-muted">Target Date</label>
                        <input
                          type="date"
                          value={targetDate}
                          onChange={(e) => {
                            setTargetDate(e.target.value)
                            if (e.target.value) {
                              setInactivityUnit('days')
                              const selectedDate = new Date(e.target.value)
                              const today = new Date()
                              today.setHours(0, 0, 0, 0)
                              selectedDate.setHours(0, 0, 0, 0)
                              const diffDays = Math.ceil((selectedDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
                              if (diffDays > 0) setInactivityDays(diffDays.toString())
                              else { setInactivityDays(''); alert('Please select a future date') }
                            }
                          }}
                          min={new Date().toISOString().split('T')[0]}
                          className="w-full rounded-xl border border-Heres-border bg-Heres-surface/80 p-4 text-Heres-white focus:border-Heres-accent/50 focus:outline-none"
                        />
                        {targetDate && inactivityDays && <p className="mt-2 text-xs text-Heres-accent">{formatInactivityLabel(inactivityDays, 'days')} until execution</p>}
                      </div>
                      <div>
                        <label className="mb-2 block text-sm text-Heres-muted">Delay Window (days)</label>
                        <input
                          type="number"
                          value={delayDays}
                          onChange={(e) => setDelayDays(e.target.value)}
                          className="w-full rounded-xl border border-Heres-border bg-Heres-surface/80 p-4 text-Heres-white focus:border-Heres-accent/50 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="mt-4">
                      <label className="mb-2 block text-sm text-Heres-muted">
                        {supportsMinuteMode ? 'Inactivity period' : 'Or inactivity period (days)'}
                      </label>
                      {supportsMinuteMode && (
                        <div className="mb-3 inline-flex rounded-xl border border-Heres-border bg-Heres-surface/70 p-1">
                          <button
                            type="button"
                            onClick={() => {
                              setInactivityUnit('days')
                              syncTargetDateFromDays(inactivityDays)
                            }}
                            className={`rounded-lg px-4 py-2 text-sm transition ${inactivityUnit === 'days' ? 'bg-Heres-accent/15 text-Heres-accent' : 'text-Heres-muted hover:text-Heres-white'}`}
                          >
                            Days
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setInactivityUnit('minutes')
                              setTargetDate('')
                            }}
                            className={`rounded-lg px-4 py-2 text-sm transition ${inactivityUnit === 'minutes' ? 'bg-Heres-accent/15 text-Heres-accent' : 'text-Heres-muted hover:text-Heres-white'}`}
                          >
                            Minutes
                          </button>
                        </div>
                      )}
                      <input
                        type="number"
                        value={inactivityDays}
                        onChange={(e) => {
                          setInactivityDays(e.target.value)
                          if (inactivityUnit === 'days') syncTargetDateFromDays(e.target.value)
                          else setTargetDate('')
                        }}
                        placeholder={inactivityUnit === 'minutes' ? 'Enter minutes' : 'Enter days'}
                        className="w-full rounded-xl border border-Heres-border bg-Heres-surface/80 p-4 text-Heres-white placeholder-Heres-muted focus:border-Heres-accent/50 focus:outline-none"
                      />
                      {SOLANA_CONFIG.NETWORK === 'devnet' && (
                        <div className="mt-2 flex gap-2">
                          {[1, 3, 5, 10].map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => {
                                setInactivityUnit('minutes')
                                setInactivityDays(String(m))
                                setTargetDate('')
                              }}
                              className="rounded-lg border border-Heres-accent/30 bg-Heres-accent/10 px-3 py-1 text-xs text-Heres-accent hover:bg-Heres-accent/20"
                            >
                              {m}min
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="mt-4 text-sm text-Heres-muted">
                      {targetDate
                        ? `Triggers on ${new Date(targetDate).toLocaleDateString()}, ${delayDays}-day delay.`
                        : inactivityDays
                          ? `After ${formatInactivityLabel(inactivityDays, inactivityUnit)} of inactivity, ${delayDays}-day delay.`
                          : 'Set target date or inactivity period.'}
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-Heres-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-Heres-muted">
                    {canCompleteBeneficiaries ? 'Recipients and trigger conditions are ready.' : 'Finish recipient and trigger setup before continuing.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCompletedSections((prev) => ({ ...prev, beneficiaries: true }))
                      setOpenSection('intent')
                    }}
                    disabled={!canCompleteBeneficiaries}
                    className="rounded-xl border border-Heres-accent/30 bg-Heres-accent/10 px-4 py-2.5 text-sm font-medium text-Heres-accent transition hover:bg-Heres-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Complete Step 2
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
                    onClick={() => {
                      setCompletedSections((prev) => ({ ...prev, intent: true }))
                      setOpenSection('review')
                    }}
                    disabled={!canCompleteIntent}
                    className="rounded-xl border border-Heres-accent/30 bg-Heres-accent/10 px-4 py-2.5 text-sm font-medium text-Heres-accent transition hover:bg-Heres-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Complete Step 3
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
                        {beneficiaries.map((b, i) => (
                          <div key={i} className="flex justify-between rounded-lg bg-Heres-card/80 p-2">
                            <p className="max-w-[200px] truncate font-mono text-sm text-Heres-white">
                              [{(b.chain ?? 'solana').toUpperCase()}] {b.address || 'Not set'}
                            </p>
                            <p className="text-sm font-semibold text-Heres-accent">{b.amount} {b.amountType === 'percentage' ? '%' : tokenAssetUnit}</p>
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
                      After {formatInactivityLabel(inactivityDays, inactivityUnit) || '0 days'} of inactivity, {delayDays}-day delay.
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

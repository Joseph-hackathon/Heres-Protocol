'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'
import { Shield, User } from 'lucide-react'
import { getCapsule } from '@/lib/solana'
import { getCapsulePDA } from '@/lib/program'
import { PrivyConnectButton } from '@/components/PrivyConnectButton'

const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/

type StellarCapsuleSummary = {
  id: string
  assetSymbol: string
  amount: string
  txHash: string
  memo: string
  createdAt: number
  custodyAddress: string
  status: string
}

function getPrivyStellarAddress(user: any): string | null {
  const linkedAccounts = Array.isArray(user?.linkedAccounts) ? user.linkedAccounts as Array<Record<string, any>> : []
  const stellarAccount = linkedAccounts.find((account) => {
    const address = String(account.address || account.walletAddress || account.wallet_address || account.publicKey || account.public_key || '')
    const chainType = String(account.chainType || account.chain_type || account.chain || '').toLowerCase()
    return STELLAR_PUBLIC_KEY_RE.test(address) || chainType.includes('stellar')
  })
  if (!stellarAccount) return null
  const address = String(stellarAccount.address || stellarAccount.walletAddress || stellarAccount.wallet_address || stellarAccount.publicKey || stellarAccount.public_key || '').trim()
  return STELLAR_PUBLIC_KEY_RE.test(address) ? address : null
}

export default function CapsulesEntryPage() {
  const router = useRouter()
  const wallet = useWallet()
  const { publicKey, connected } = wallet
  const { user } = usePrivy()
  const [loading, setLoading] = useState(true)
  const [hasCapsule, setHasCapsule] = useState(false)
  const [stellarCapsules, setStellarCapsules] = useState<StellarCapsuleSummary[]>([])
  const stellarWalletAddress = getPrivyStellarAddress(user)

  useEffect(() => {
    if (!connected || !publicKey) {
      setLoading(false)
      setHasCapsule(false)
      return
    }
    let cancelled = false
    setLoading(true)
    getCapsule(publicKey)
      .then((capsule) => {
        if (cancelled) return
        if (capsule) {
          const [capsulePDA] = getCapsulePDA(publicKey)
          router.replace(`/capsules/${capsulePDA.toBase58()}`)
          setHasCapsule(true)
        } else {
          setHasCapsule(false)
        }
      })
      .catch(() => {
        if (!cancelled) setHasCapsule(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [connected, publicKey, router])

  useEffect(() => {
    if (!publicKey && !stellarWalletAddress) {
      setStellarCapsules([])
      return
    }
    let cancelled = false
    const query = new URLSearchParams()
    if (publicKey) query.set('owner', publicKey.toBase58())
    if (stellarWalletAddress) query.set('stellarSource', stellarWalletAddress)
    fetch(`/api/stellar/capsules?${query.toString()}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((payload) => {
        if (!cancelled) setStellarCapsules(Array.isArray(payload?.capsules) ? payload.capsules : [])
      })
      .catch(() => {
        if (!cancelled) setStellarCapsules([])
      })
    return () => { cancelled = true }
  }, [publicKey, stellarWalletAddress])

  if (loading && connected && publicKey) {
    return (
      <div className="min-h-screen bg-hero text-Heres-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-Heres-accent border-t-transparent" />
          <p className="text-Heres-muted">Finding your capsule...</p>
        </div>
      </div>
    )
  }

  if (connected && hasCapsule) {
    return (
      <div className="min-h-screen bg-hero text-Heres-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-Heres-accent border-t-transparent" />
          <p className="text-Heres-muted">Redirecting to your capsule...</p>
        </div>
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="min-h-screen bg-hero pt-24 pb-16 px-4">
        <div className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-12">
          <div className="card-Heres p-8 sm:p-12 text-center w-full">
            <User className="mx-auto mb-6 h-14 w-14 text-Heres-accent" />
            <h2 className="mb-3 text-2xl font-bold text-Heres-white">My Capsule</h2>
            <p className="mb-6 text-Heres-muted">
              Connect your wallet to view your capsule or create a new one.
            </p>
            <div className="flex flex-col gap-3">
              <div className="wallet-menu-container flex justify-center">
                <PrivyConnectButton />
              </div>
              <Link
                href="/create"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-Heres-border bg-Heres-card/80 px-4 py-3 text-sm font-medium text-Heres-muted hover:border-Heres-accent/40 hover:text-Heres-accent"
              >
                Create Capsule
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (stellarCapsules.length > 0) {
    return (
      <div className="min-h-screen bg-hero pt-24 pb-16 px-4">
        <div className="mx-auto max-w-3xl px-4 py-12">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-Heres-muted">My Capsule</p>
              <h2 className="mt-2 text-3xl font-bold text-Heres-white">Stellar-Origin Capsules</h2>
              <p className="mt-2 text-sm text-Heres-muted">These capsules are locked in the Stellar testnet custody account.</p>
            </div>
            <PrivyConnectButton />
          </div>
          <div className="grid gap-4">
            {stellarCapsules.map((capsule) => (
              <div key={capsule.id} className="card-Heres p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-Heres-accent">{capsule.status}</p>
                    <h3 className="mt-2 text-xl font-semibold text-Heres-white">
                      {capsule.amount} {capsule.assetSymbol}
                    </h3>
                    <p className="mt-1 text-sm text-Heres-muted">Memo: {capsule.memo}</p>
                  </div>
                  <p className="text-sm text-Heres-muted">{new Date(capsule.createdAt).toLocaleString()}</p>
                </div>
                <div className="mt-4 grid gap-2 rounded-xl border border-Heres-border/70 bg-black/20 p-3 text-xs text-Heres-muted">
                  <p className="break-all">Custody: <span className="font-mono text-Heres-white/85">{capsule.custodyAddress}</span></p>
                  <p className="break-all">Transaction: <span className="font-mono text-Heres-white/85">{capsule.txHash}</span></p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-hero pt-24 pb-16 px-4">
      <div className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-12">
        <div className="card-Heres p-8 sm:p-12 text-center w-full">
          <Shield className="mx-auto mb-6 h-14 w-14 text-Heres-accent" />
          <h2 className="mb-3 text-2xl font-bold text-Heres-white">No Capsule Found</h2>
          <p className="mb-6 text-Heres-muted">
            You don&apos;t have a capsule yet. Create one to get started.
          </p>
          <Link
            href="/create"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-Heres-accent bg-Heres-accent/10 px-6 py-3 text-sm font-semibold text-Heres-accent hover:bg-Heres-accent/20"
          >
            Create Capsule
          </Link>
        </div>
      </div>
    </div>
  )
}

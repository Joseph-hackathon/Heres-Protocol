'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Shield, User } from 'lucide-react'
import dynamic from 'next/dynamic'
import { getCapsule } from '@/lib/solana'
import { getCapsulePDA } from '@/lib/program'

const WalletMultiButton = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false }
)

export default function CapsulesEntryPage() {
  const router = useRouter()
  const wallet = useWallet()
  const { publicKey, connected } = wallet
  const [loading, setLoading] = useState(true)
  const [hasCapsule, setHasCapsule] = useState(false)

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
                <WalletMultiButton />
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

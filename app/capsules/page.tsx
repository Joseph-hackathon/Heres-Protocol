'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useHeresWallet } from '@/hooks/useHeresWallet'
import Link from 'next/link'
import { Shield, User, Loader2, RefreshCw } from 'lucide-react'
import { getCapsuleAccountLocations } from '@/lib/solana'
import { hasExistingCapsuleAccounts } from '@/lib/capsule-lifecycle'
import { Button, Card } from '@/components/ui'
import { PrivyLoginButton } from '@/components/PrivyLoginButton'

function CenteredStatus({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-hero text-vellum">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-brand" aria-hidden />
        <p className="text-ash">{label}</p>
      </div>
    </div>
  )
}

export default function CapsulesEntryPage() {
  const router = useRouter()
  const wallet = useHeresWallet()
  const { publicKey, connected } = wallet
  const [loading, setLoading] = useState(true)
  const [hasCapsule, setHasCapsule] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    if (!connected || !publicKey) {
      setLoading(false)
      setHasCapsule(false)
      setLoadError(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    getCapsuleAccountLocations(publicKey)
      .then((locations) => {
        if (cancelled) return
        if (locations.switch !== 'missing') {
          router.replace(`/capsules/${locations.switchAddress}`)
          setHasCapsule(true)
        } else if (hasExistingCapsuleAccounts(locations)) {
          setHasCapsule(false)
          setLoadError(true)
        } else {
          setHasCapsule(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasCapsule(false)
          setLoadError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, router, loadAttempt])

  if (loading && connected && publicKey) {
    return <CenteredStatus label="Finding your capsule..." />
  }

  if (connected && hasCapsule) {
    return <CenteredStatus label="Redirecting to your capsule..." />
  }

  if (connected && loadError) {
    return (
      <div className="min-h-screen bg-hero px-4 pb-16 pt-24">
        <div className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-12">
          <Card className="w-full p-8 text-center sm:p-12">
            <RefreshCw className="mx-auto mb-6 h-14 w-14 text-amber-300" aria-hidden />
            <h2 className="mb-3 font-serif text-2xl font-semibold text-vellum">Could not check your capsule</h2>
            <p className="mb-6 text-ash">
              Heres could not read the current on-chain state. Retry before creating or changing anything.
            </p>
            <Button variant="primary" size="md" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
              Retry check
            </Button>
          </Card>
        </div>
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="min-h-screen bg-hero px-4 pb-16 pt-24">
        <div className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-12">
          <Card className="w-full p-8 text-center sm:p-12">
            <User className="mx-auto mb-6 h-14 w-14 text-brand" aria-hidden />
            <h2 className="mb-3 font-serif text-2xl font-semibold text-vellum">My Capsule</h2>
            <p className="mb-6 text-ash">Sign in to view your capsule or create a new one.</p>
            <div className="flex flex-col gap-3">
              <div className="wallet-menu-container flex justify-center">
                <PrivyLoginButton />
              </div>
              <Link
                href="/create"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-hair bg-card px-4 py-3 text-sm font-medium text-ash transition-colors hover:border-brand/40 hover:text-brand"
              >
                Create Capsule
              </Link>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-hero px-4 pb-16 pt-24">
      <div className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-12">
        <Card className="w-full p-8 text-center sm:p-12">
          <Shield className="mx-auto mb-6 h-14 w-14 text-brand" aria-hidden />
          <h2 className="mb-3 font-serif text-2xl font-semibold text-vellum">No Capsule Found</h2>
          <p className="mb-6 text-ash">You don&apos;t have a capsule yet. Create one to get started.</p>
          <Link
            href="/create"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-brand/90"
          >
            Create Capsule
          </Link>
        </Card>
      </div>
    </div>
  )
}

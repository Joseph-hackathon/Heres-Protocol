import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { verifyCreSignedRequest } from '@/lib/cre/auth'
import { fetchCapsuleStateByAddress } from '@/lib/cre/solana'
import { queueStellarSettlementForCapsule } from '@/lib/stellar'

export async function POST(request: NextRequest) {
  try {
    let body: { capsule?: string; owner?: string; timestamp?: number }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const capsuleAddress = body.capsule?.trim()
    const owner = body.owner?.trim()
    const timestamp = Number(body.timestamp)
    const signature = request.headers.get('x-cre-signature')?.trim()

    if (!capsuleAddress || !owner || !signature || !Number.isFinite(timestamp)) {
      return NextResponse.json({ error: 'capsule, owner, timestamp, x-cre-signature are required' }, { status: 400 })
    }

    let capsulePubkey: PublicKey
    let ownerPubkey: PublicKey
    try {
      capsulePubkey = new PublicKey(capsuleAddress)
      ownerPubkey = new PublicKey(owner)
    } catch {
      return NextResponse.json({ error: 'Invalid capsule or owner address' }, { status: 400 })
    }

    const capsule = await fetchCapsuleStateByAddress(capsulePubkey)
    if (!capsule) {
      return NextResponse.json({ error: 'Capsule not found' }, { status: 404 })
    }
    if (!capsule.owner.equals(ownerPubkey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const isValidSignature = verifyCreSignedRequest({
      action: 'stellar-settlement',
      owner,
      capsuleAddress,
      timestamp,
      signatureBase64: signature,
    })
    if (!isValidSignature) {
      return NextResponse.json({ error: 'Invalid or expired signature' }, { status: 401 })
    }

    const result = await queueStellarSettlementForCapsule(capsuleAddress)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[Stellar settlement] Internal error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

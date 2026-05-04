import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { getDeliveryStatus } from '@/lib/cre/service'
import { verifyCreSignedRequest } from '@/lib/cre/auth'
import { fetchCapsuleStateByAddress } from '@/lib/cre/solana'

export async function GET(request: NextRequest) {
  const capsuleAddress = request.nextUrl.searchParams.get('capsule')?.trim()
  const owner = request.nextUrl.searchParams.get('owner')?.trim()
  const timestamp = Number(request.nextUrl.searchParams.get('timestamp'))
  const signature = request.headers.get('x-cre-signature')?.trim()
  if (!capsuleAddress) {
    return NextResponse.json({ error: 'capsule query parameter is required' }, { status: 400 })
  }
  if (!owner || !signature || !Number.isFinite(timestamp)) {
    return NextResponse.json({ error: 'owner, timestamp, x-cre-signature are required' }, { status: 400 })
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
    action: 'delivery-status',
    owner,
    capsuleAddress,
    timestamp,
    signatureBase64: signature,
  })
  if (!isValidSignature) {
    return NextResponse.json({ error: 'Invalid or expired signature' }, { status: 401 })
  }

  const entries = getDeliveryStatus(capsuleAddress)
  return NextResponse.json({
    ok: true,
    entries: entries.map((entry) => ({
      idempotencyKey: entry.idempotencyKey,
      status: entry.status,
      updatedAt: entry.updatedAt,
      lastError: entry.lastError,
    })),
  })
}

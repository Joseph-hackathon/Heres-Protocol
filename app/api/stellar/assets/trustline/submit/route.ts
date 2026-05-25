import { NextRequest, NextResponse } from 'next/server'
import { submitSignedStellarXdr } from '@/lib/stellar-capsules'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await submitSignedStellarXdr({
      unsignedXdr: String(body?.unsignedXdr || ''),
      signerPublicKey: String(body?.signerPublicKey || '').trim(),
      signatureHex: String(body?.signatureHex || '').trim(),
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit Stellar trustline'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

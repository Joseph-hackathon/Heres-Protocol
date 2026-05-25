import { NextRequest, NextResponse } from 'next/server'
import { parseAssetSymbol, recordStellarCapsule, submitSignedStellarXdr } from '@/lib/stellar-capsules'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await submitSignedStellarXdr({
      unsignedXdr: String(body?.unsignedXdr || ''),
      signerPublicKey: String(body?.signerPublicKey || '').trim(),
      signatureHex: String(body?.signatureHex || '').trim(),
    })

    const assetSymbol = parseAssetSymbol(body?.assetSymbol)
    const now = Date.now()
    await recordStellarCapsule({
      id: String(body?.id || result.hash).trim(),
      owner: String(body?.owner || '').trim(),
      stellarSource: String(body?.signerPublicKey || '').trim(),
      custodyAddress: String(body?.custodyAddress || '').trim(),
      assetSymbol,
      assetCode: String(body?.assetCode || assetSymbol).trim(),
      assetIssuer: body?.assetIssuer ? String(body.assetIssuer).trim() : null,
      amount: String(body?.amount || '').trim(),
      beneficiaries: Array.isArray(body?.beneficiaries) ? body.beneficiaries : [],
      inactivityValue: Number(body?.inactivityValue) || 0,
      inactivityUnit: body?.inactivityUnit === 'minutes' ? 'minutes' : 'days',
      delayDays: Number(body?.delayDays) || 0,
      memo: String(body?.memo || '').trim(),
      unsignedXdr: String(body?.unsignedXdr || ''),
      sourceSignature: String(body?.signatureHex || '').trim(),
      txHash: result.hash,
      status: 'custodied',
      cre: body?.cre || null,
      createdAt: now,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit Stellar capsule'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

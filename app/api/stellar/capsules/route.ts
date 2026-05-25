import { NextRequest, NextResponse } from 'next/server'
import { listStellarCapsules } from '@/lib/stellar-capsules'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const owner = searchParams.get('owner')
  const stellarSource = searchParams.get('stellarSource')
  const capsules = await listStellarCapsules({ owner, stellarSource })
  return NextResponse.json({ ok: true, capsules })
}

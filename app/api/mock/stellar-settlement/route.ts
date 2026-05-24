import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null)
  const settlements = Array.isArray(payload?.settlements) ? payload.settlements : null

  if (!payload || !settlements) {
    return NextResponse.json({ error: 'settlements array is required' }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    receivedAt: Date.now(),
    capsule: payload.capsule || null,
    owner: payload.owner || null,
    settlementCount: settlements.length,
  })
}

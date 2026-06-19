import { NextRequest, NextResponse } from 'next/server'
import { registerCapsuleOwner } from '@/lib/capsule-registry'
import { ownerBody, firstError } from '@/lib/schemas'

export async function POST(request: NextRequest) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = ownerBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 })
  }

  try {
    await registerCapsuleOwner(parsed.data.owner)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to register owner' }, { status: 500 })
  }
}

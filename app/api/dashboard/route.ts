import { NextRequest, NextResponse } from 'next/server'
import { getDashboardSnapshot } from '@/lib/dashboard'
import { verifyAdminRequest } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  try {
    // Admin-gated: returns every owner's capsule (the explorer feed). Public
    // aggregate stats are served unauthenticated by /api/capsules/summary.
    const auth = verifyAdminRequest(request.headers)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1'
    const includeHistory = request.nextUrl.searchParams.get('history') === '1'
    const fullScan = request.nextUrl.searchParams.get('full') === '1'
    const snapshot = await getDashboardSnapshot(forceRefresh, includeHistory, fullScan)
    return NextResponse.json(snapshot)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load dashboard snapshot' },
      { status: 500 }
    )
  }
}

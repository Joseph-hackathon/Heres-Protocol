import { NextRequest, NextResponse } from 'next/server'
import { ensureDashboardPrewarmScheduler, getCapsulesListPage, type CapsuleListFilter, type CapsuleListSort } from '@/lib/dashboard'
import { verifyAdminRequest } from '@/lib/admin-auth'

const validFilters = new Set<CapsuleListFilter>(['all', 'live', 'created', 'executed', 'active', 'expired'])
const validSorts = new Set<CapsuleListSort>(['newest', 'oldest'])

export async function GET(request: NextRequest) {
  try {
    // Admin-gated: paginated per-capsule feed of every owner's data.
    const auth = verifyAdminRequest(request.headers)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    ensureDashboardPrewarmScheduler()
    const { searchParams } = request.nextUrl
    const page = Number(searchParams.get('page') || '1')
    const limit = Number(searchParams.get('limit') || '20')
    const filter = (searchParams.get('filter') || 'all') as CapsuleListFilter
    const sort = (searchParams.get('sort') || 'newest') as CapsuleListSort
    const query = searchParams.get('query') || ''
    const forceRefresh = searchParams.get('refresh') === '1'

    const payload = await getCapsulesListPage({
      page: Number.isFinite(page) ? page : 1,
      limit: Number.isFinite(limit) ? limit : 20,
      filter: validFilters.has(filter) ? filter : 'all',
      sort: validSorts.has(sort) ? sort : 'newest',
      query,
      forceRefresh,
    })

    return NextResponse.json(payload)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load capsule list' },
      { status: 500 }
    )
  }
}

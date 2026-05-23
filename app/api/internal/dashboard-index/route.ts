export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { claimPendingIngestionLogs, completeIngestionLog, failIngestionLog, getIngestionBacklogCount, saveSyncCheckpoint } from '@/lib/dashboard-store'
import { ensureDashboardPrewarmScheduler, triggerDashboardPrewarm } from '@/lib/dashboard'

function isAuthorized(request: NextRequest): boolean {
  const token = process.env.DASHBOARD_PREWARM_TOKEN || process.env.CRON_SECRET
  if (!token) return false

  const authHeader = request.headers.get('authorization')
  const headerToken = request.headers.get('x-prewarm-token')
  return authHeader === `Bearer ${token}` || headerToken === token
}

async function processIngestionBatch(limit: number) {
  const claimed = await claimPendingIngestionLogs(limit)
  if (!claimed.length) return { claimed: 0 }

  try {
    await triggerDashboardPrewarm(true)
    await Promise.all(claimed.map((row) => completeIngestionLog(row.id)))
    return { claimed: claimed.length }
  } catch (error: any) {
    await Promise.all(
      claimed.map((row) => failIngestionLog(row.id, error?.message || 'Worker refresh failed'))
    )
    throw error
  }
}

async function handleRequest(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  ensureDashboardPrewarmScheduler()

  const limit = Math.max(1, Math.min(100, Number(request.nextUrl.searchParams.get('limit') || '25')))
  const force = request.nextUrl.searchParams.get('force') === '1'
  const backlogBefore = await getIngestionBacklogCount()
  const batch = await processIngestionBatch(limit)

  if (force && batch.claimed === 0) {
    await triggerDashboardPrewarm(true)
  }

  const backlogAfter = await getIngestionBacklogCount()
  await saveSyncCheckpoint('dashboard:indexer:last-run', {
    ranAt: Date.now(),
    forced: force,
    claimed: batch.claimed,
    backlogBefore,
    backlogAfter,
  })

  return NextResponse.json({
    ok: true,
    forced: force,
    claimed: batch.claimed,
    backlogBefore,
    backlogAfter,
    ranAt: Date.now(),
  })
}

export async function GET(request: NextRequest) {
  try {
    return await handleRequest(request)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to run dashboard index worker' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    return await handleRequest(request)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to run dashboard index worker' },
      { status: 500 }
    )
  }
}

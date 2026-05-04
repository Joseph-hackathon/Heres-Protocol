import { NextRequest, NextResponse } from 'next/server'
import { Connection, PublicKey } from '@solana/web3.js'
import { getSolanaConnection, getSolanaFallbackConnection } from '@/config/solana'
import { MAGICBLOCK_ER } from '@/constants'
import { getRegisteredOwners } from '@/lib/capsule-registry'
import { getCapsulePDA } from '@/lib/program'
import { computeCapsuleStatus, validateWalletQuery } from '@/lib/mobile'

const ACCOUNT_INFO_BATCH_SIZE = 100

function readI64(bytes: Uint8Array, start: number): bigint {
  let result = 0n
  for (let i = 0; i < 8; i += 1) {
    result |= BigInt(bytes[start + i]) << BigInt(i * 8)
  }
  if (result & (1n << 63n)) {
    result -= 1n << 64n
  }
  return result
}

function readU32(bytes: Uint8Array, start: number): number {
  return bytes[start] | (bytes[start + 1] << 8) | (bytes[start + 2] << 16) | (bytes[start + 3] << 24)
}

function decodeCapsuleAccount(data: Uint8Array) {
  if (!data || data.length < 60) return null

  let offset = 8
  offset += 32
  const inactivityPeriod = Number(readI64(data, offset))
  offset += 8
  const lastActivity = Number(readI64(data, offset))
  offset += 8
  const intentDataLength = readU32(data, offset)
  offset += 4
  offset += intentDataLength
  const isActive = data[offset] === 1
  offset += 1
  const hasExecutedAt = data[offset] === 1
  offset += 1

  return {
    inactivityPeriod,
    lastActivity,
    isActive,
    executedAt: hasExecutedAt ? Number(readI64(data, offset)) : null,
  }
}

async function getMultipleAccountsInfoBatched(connection: Connection, publicKeys: PublicKey[]) {
  if (!publicKeys.length) return []

  const batches: PublicKey[][] = []
  for (let index = 0; index < publicKeys.length; index += ACCOUNT_INFO_BATCH_SIZE) {
    batches.push(publicKeys.slice(index, index + ACCOUNT_INFO_BATCH_SIZE))
  }

  const results = await Promise.all(
    batches.map((batch) => connection.getMultipleAccountsInfo(batch, 'confirmed'))
  )

  return results.flat()
}

export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get('wallet')
    const validation = validateWalletQuery(wallet)
    if (!validation.ok) {
      return NextResponse.json({
        wallet: null,
        summary: { total: 0, active: 0, executed: 0, expired: 0 },
        items: [],
      })
    }

    try {
      new PublicKey(wallet!)
    } catch {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }

    const ownerSet = new Set<string>()
    ownerSet.add(wallet!)

    if (process.env.NODE_ENV !== 'production' && request.nextUrl.searchParams.get('includeRegistered') === '1') {
      const owners = await getRegisteredOwners()
      owners.forEach((owner) => ownerSet.add(owner))
    }

    const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
    const ownerEntries = Array.from(ownerSet).flatMap((owner) => {
      try {
        const ownerKey = new PublicKey(owner)
        const [capsulePda] = getCapsulePDA(ownerKey)
        return [{ owner, capsulePda }]
      } catch {
        return []
      }
    })

    const connection = getSolanaConnection()
    const fallbackConnection = getSolanaFallbackConnection()
    let accountInfos: Array<any | null> = []
    try {
      accountInfos = await getMultipleAccountsInfoBatched(
        connection,
        ownerEntries.map((entry) => entry.capsulePda)
      )
    } catch {
      accountInfos = await getMultipleAccountsInfoBatched(
        fallbackConnection,
        ownerEntries.map((entry) => entry.capsulePda)
      )
    }

    const delegatedIndexes = ownerEntries
      .map((_, index) => index)
      .filter((index) => accountInfos[index]?.owner?.equals(delegationProgramId))

    if (delegatedIndexes.length) {
      try {
        const erConnection = new Connection(MAGICBLOCK_ER.ER_RPC_URL, { commitment: 'confirmed' })
        const erInfos = await getMultipleAccountsInfoBatched(
          erConnection,
          delegatedIndexes.map((index) => ownerEntries[index].capsulePda)
        )
        delegatedIndexes.forEach((ownerIndex, delegatedIndex) => {
          const erInfo = erInfos[delegatedIndex]
          if (erInfo?.data) {
            accountInfos[ownerIndex] = {
              ...accountInfos[ownerIndex],
              data: erInfo.data,
            }
          }
        })
      } catch {
        // Keep base-layer data if ER refresh fails.
      }
    }

    const items = ownerEntries
      .map((entry, index) => {
        const accountInfo = accountInfos[index]
        if (!accountInfo?.data) return null
        const capsule = decodeCapsuleAccount(accountInfo.data)
        if (!capsule) return null

        const status = computeCapsuleStatus({
          isActive: capsule.isActive,
          lastActivity: capsule.lastActivity,
          inactivityPeriod: capsule.inactivityPeriod,
          executedAt: capsule.executedAt,
        })

        return {
          capsuleAddress: entry.capsulePda.toBase58(),
          owner: entry.owner,
          status,
          inactivitySeconds: capsule.inactivityPeriod,
          lastActivityAt: capsule.lastActivity * 1000,
          executedAt: capsule.executedAt ? capsule.executedAt * 1000 : null,
          nextInactivityDeadline: (capsule.lastActivity + capsule.inactivityPeriod) * 1000,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)

    const summary = {
      total: items.length,
      active: items.filter((item) => item.status === 'active').length,
      executed: items.filter((item) => item.status === 'executed').length,
      expired: items.filter((item) => item.status === 'expired').length,
    }

    return NextResponse.json({
      wallet,
      summary,
      items,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch dashboard capsules' },
      { status: 500 }
    )
  }
}

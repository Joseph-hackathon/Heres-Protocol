import 'server-only'

import fs from 'fs/promises'
import path from 'path'
import { PublicKey } from '@solana/web3.js'
import { fetchCapsuleStateByAddress } from '@/lib/cre/solana'
import { getDataFilePath } from '@/lib/runtime-paths'
import { parseIntentPayload } from '@/utils/intent'

export type StellarSettlementEntry = {
  capsule: string
  owner: string
  stellarAddress: string
  memo: string
  amount: string
  status: 'queued' | 'dispatched'
  createdAt: number
}

type QueueFile = {
  entries: StellarSettlementEntry[]
}

async function readQueueFile(filePath: string): Promise<QueueFile> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as QueueFile
    return Array.isArray(parsed?.entries) ? parsed : { entries: [] }
  } catch {
    return { entries: [] }
  }
}

async function writeQueueFile(filePath: string, payload: QueueFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
}

export async function queueStellarSettlementForCapsule(capsuleAddress: string): Promise<{
  ok: boolean
  status: 'queued' | 'dispatched'
  queuedCount: number
  dispatchedCount: number
}> {
  const capsule = await fetchCapsuleStateByAddress(new PublicKey(capsuleAddress))
  if (!capsule) {
    throw new Error('Capsule not found')
  }

  const parsed = parseIntentPayload(capsule.intentData)
  const beneficiaries = Array.isArray((parsed as any)?.beneficiaries) ? (parsed as any).beneficiaries : []
  const stellarEntries = beneficiaries
    .filter((beneficiary: any) => beneficiary?.chain === 'stellar' && beneficiary?.address && beneficiary?.amount)
    .map((beneficiary: any) => ({
      capsule: capsuleAddress,
      owner: capsule.owner.toBase58(),
      stellarAddress: String(beneficiary.address),
      memo: String(beneficiary.destinationChainSelector || ''),
      amount: String(beneficiary.amount),
      status: 'queued' as const,
      createdAt: Date.now(),
    }))

  if (stellarEntries.length === 0) {
    return { ok: true, status: 'queued', queuedCount: 0, dispatchedCount: 0 }
  }

  let dispatchedCount = 0
  const webhookUrl = process.env.STELLAR_SETTLEMENT_WEBHOOK_URL?.trim()
  if (webhookUrl) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capsule: capsuleAddress,
        owner: capsule.owner.toBase58(),
        settlements: stellarEntries,
      }),
    })
    if (!response.ok) {
      throw new Error(`Stellar settlement webhook failed with ${response.status}`)
    }
    dispatchedCount = stellarEntries.length
    stellarEntries.forEach((entry: StellarSettlementEntry) => {
      entry.status = 'dispatched'
    })
  }

  const filePath = getDataFilePath('stellar-settlements.json')
  const existing = await readQueueFile(filePath)
  await writeQueueFile(filePath, { entries: [...existing.entries, ...stellarEntries] })

  return {
    ok: true,
    status: dispatchedCount > 0 ? 'dispatched' : 'queued',
    queuedCount: stellarEntries.length,
    dispatchedCount,
  }
}

import 'server-only'

import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { getAssetConfig, isSupportedAssetSymbol, SupportedAssetSymbol } from '@/lib/assets'
import { getDataFilePath } from '@/lib/runtime-paths'

const STELLAR_TESTNET_HORIZON_URL = 'https://horizon-testnet.stellar.org'
const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/

export type StellarCapsuleRecord = {
  id: string
  owner: string
  stellarSource: string
  custodyAddress: string
  assetSymbol: SupportedAssetSymbol
  assetCode: string
  assetIssuer: string | null
  amount: string
  beneficiaries: unknown[]
  inactivityValue: number
  inactivityUnit: 'days' | 'minutes'
  delayDays: number
  memo: string
  unsignedXdr: string
  sourceSignature: string
  txHash: string
  status: 'custodied'
  cre?: unknown
  createdAt: number
}

type StellarCapsuleFile = {
  capsules: StellarCapsuleRecord[]
}

export function validateStellarPublicKey(publicKey: string, label = 'Stellar public key') {
  if (!STELLAR_PUBLIC_KEY_RE.test(publicKey)) {
    throw new Error(`${label} is invalid`)
  }
  Keypair.fromPublicKey(publicKey)
}

export function getStellarServer() {
  return new Horizon.Server(STELLAR_TESTNET_HORIZON_URL)
}

export function getCustodyPublicKey() {
  const publicKey = process.env.STELLAR_CUSTODY_PUBLIC_KEY || process.env.NEXT_PUBLIC_STELLAR_CUSTODY_PUBLIC_KEY
  if (!publicKey) {
    throw new Error('Stellar custody public key is not configured')
  }
  validateStellarPublicKey(publicKey, 'Stellar custody public key')
  return publicKey
}

export function getStellarSdkAsset(symbol: SupportedAssetSymbol) {
  const config = getAssetConfig(symbol)
  if (!config.stellar) {
    throw new Error(`${symbol} is not configured for Stellar`)
  }
  if (config.stellar.native) {
    return Asset.native()
  }
  if (!config.stellar.issuer) {
    throw new Error(`${symbol} Stellar issuer is not configured`)
  }
  validateStellarPublicKey(config.stellar.issuer, `${symbol} Stellar issuer`)
  return new Asset(config.stellar.code, config.stellar.issuer)
}

export function validateStellarAmount(amount: string) {
  const normalized = amount.trim()
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error('Invalid Stellar amount')
  }
  const [whole, fraction = ''] = normalized.split('.')
  if (BigInt(whole || '0') === 0n && Number(`0.${fraction || '0'}`) <= 0) {
    throw new Error('Stellar amount must be greater than zero')
  }
  if (fraction.length > 7) {
    throw new Error('Stellar amounts support up to 7 decimal places')
  }
  return normalized
}

async function fundTestnetAccountIfMissing(publicKey: string) {
  const server = getStellarServer()
  try {
    return await server.loadAccount(publicKey)
  } catch (error: any) {
    if (error?.response?.status !== 404) throw error
  }

  const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Stellar friendbot failed: ${response.status} ${text}`)
  }
  return server.loadAccount(publicKey)
}

function hasTrustline(account: any, asset: Asset) {
  if (asset.isNative()) return true
  return account.balances?.some((balance: any) => (
    balance.asset_type !== 'native' &&
    balance.asset_code === asset.getCode() &&
    balance.asset_issuer === asset.getIssuer()
  ))
}

export async function prepareStellarTrustline(input: {
  source: string
  assetSymbol: SupportedAssetSymbol
}) {
  validateStellarPublicKey(input.source, 'Stellar source')
  const asset = getStellarSdkAsset(input.assetSymbol)
  if (asset.isNative()) {
    return { alreadyTrusted: true, unsignedXdr: null, hashHex: null }
  }

  const account = await fundTestnetAccountIfMissing(input.source)
  if (hasTrustline(account, asset)) {
    return { alreadyTrusted: true, unsignedXdr: null, hashHex: null }
  }

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(60)
    .build()

  return {
    alreadyTrusted: false,
    unsignedXdr: tx.toXDR(),
    hashHex: tx.hash().toString('hex'),
  }
}

export async function prepareStellarCustodyPayment(input: {
  source: string
  assetSymbol: SupportedAssetSymbol
  amount: string
}) {
  validateStellarPublicKey(input.source, 'Stellar source')
  const custodyAddress = getCustodyPublicKey()
  const asset = getStellarSdkAsset(input.assetSymbol)
  const amount = validateStellarAmount(input.amount)
  const account = await fundTestnetAccountIfMissing(input.source)
  if (!hasTrustline(account, asset)) {
    throw new Error(`${input.assetSymbol} trustline is required before custody payment`)
  }

  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const memo = `HERES-${id}`
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: custodyAddress,
      asset,
      amount,
    }))
    .addMemo(Memo.text(memo))
    .setTimeout(60)
    .build()

  const config = getAssetConfig(input.assetSymbol)
  return {
    id,
    memo,
    custodyAddress,
    unsignedXdr: tx.toXDR(),
    hashHex: tx.hash().toString('hex'),
    assetCode: config.stellar?.code || input.assetSymbol,
    assetIssuer: config.stellar?.issuer || null,
  }
}

export async function submitSignedStellarXdr(input: {
  unsignedXdr: string
  signerPublicKey: string
  signatureHex: string
}) {
  validateStellarPublicKey(input.signerPublicKey, 'Stellar signer')
  const signatureHex = input.signatureHex.replace(/^0x/, '')
  if (!/^[0-9a-fA-F]+$/.test(signatureHex) || signatureHex.length % 2 !== 0) {
    throw new Error('Stellar signature must be hex encoded')
  }

  const tx = TransactionBuilder.fromXDR(input.unsignedXdr, Networks.TESTNET) as any
  if (tx.source && tx.source !== input.signerPublicKey) {
    throw new Error('Stellar signer does not match transaction source')
  }
  tx.addSignature(input.signerPublicKey, Buffer.from(signatureHex, 'hex').toString('base64'))
  const response = await getStellarServer().submitTransaction(tx)
  return {
    hash: response.hash,
    ledger: response.ledger,
    successful: response.successful,
  }
}

export async function fundStellarIssuedAsset(input: {
  destination: string
  assetSymbol: SupportedAssetSymbol
}) {
  validateStellarPublicKey(input.destination, 'Stellar destination')
  const asset = getStellarSdkAsset(input.assetSymbol)
  if (asset.isNative()) {
    return { funded: false, reason: 'native-asset' as const }
  }

  const distributorSecret = process.env.STELLAR_DISTRIBUTOR_SECRET_KEY
  if (!distributorSecret) {
    throw new Error('STELLAR_DISTRIBUTOR_SECRET_KEY is required for testnet asset faucet')
  }
  const distributor = Keypair.fromSecret(distributorSecret)
  const amount = input.assetSymbol === 'AUDD' ? '1000' : '10'
  const server = getStellarServer()
  const account = await server.loadAccount(distributor.publicKey())
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: input.destination,
      asset,
      amount,
    }))
    .setTimeout(60)
    .build()
  tx.sign(distributor)
  const response = await server.submitTransaction(tx)
  return { funded: true, amount, hash: response.hash }
}

async function readCapsuleFile(): Promise<StellarCapsuleFile> {
  try {
    const raw = await fs.readFile(getDataFilePath('stellar-capsules.json'), 'utf8')
    const parsed = JSON.parse(raw) as StellarCapsuleFile
    return Array.isArray(parsed?.capsules) ? parsed : { capsules: [] }
  } catch {
    return { capsules: [] }
  }
}

async function writeCapsuleFile(payload: StellarCapsuleFile) {
  const filePath = getDataFilePath('stellar-capsules.json')
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
}

export async function recordStellarCapsule(record: StellarCapsuleRecord) {
  const existing = await readCapsuleFile()
  await writeCapsuleFile({
    capsules: [record, ...existing.capsules.filter((capsule) => capsule.id !== record.id)],
  })
}

export async function listStellarCapsules(input: {
  owner?: string | null
  stellarSource?: string | null
}) {
  const file = await readCapsuleFile()
  return file.capsules.filter((capsule) => (
    (!input.owner || capsule.owner === input.owner) &&
    (!input.stellarSource || capsule.stellarSource === input.stellarSource)
  ))
}

export function parseAssetSymbol(input: unknown): SupportedAssetSymbol {
  if (!isSupportedAssetSymbol(input)) {
    throw new Error('Unsupported asset symbol')
  }
  return input
}

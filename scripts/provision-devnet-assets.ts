import fs from 'fs'
import os from 'os'
import path from 'path'
import bs58 from 'bs58'
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token'
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair as StellarKeypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'

const SOLANA_ASSETS = [
  { symbol: 'BTC', decimals: 8, initialUiAmount: 10 },
  { symbol: 'ETH', decimals: 8, initialUiAmount: 100 },
  { symbol: 'AUDD', decimals: 6, initialUiAmount: 100_000 },
]

const STELLAR_ASSETS = [
  { symbol: 'BTC' },
  { symbol: 'ETH' },
  { symbol: 'AUDD' },
]

const SECRET_ENV_KEYS = new Set([
  'STELLAR_CUSTODY_SECRET_KEY',
  'STELLAR_DISTRIBUTOR_SECRET_KEY',
  'STELLAR_BTC_ISSUER_SECRET_KEY',
  'STELLAR_ETH_ISSUER_SECRET_KEY',
  'STELLAR_AUDD_ISSUER_SECRET_KEY',
])

function readSolanaKeypair(): Keypair {
  const rawSecret = process.env.SOLANA_DEVNET_KEYPAIR
  if (rawSecret) {
    return Keypair.fromSecretKey(bs58.decode(rawSecret))
  }

  const keypairPath = process.env.SOLANA_KEYPAIR_PATH || path.join(os.homedir(), '.config/solana/id.json')
  const parsed = JSON.parse(fs.readFileSync(keypairPath, 'utf8')) as number[]
  return Keypair.fromSecretKey(Uint8Array.from(parsed))
}

async function fundStellarTestAccount(publicKey: string) {
  const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Friendbot failed for ${publicKey}: ${response.status} ${text}`)
  }
}

async function provisionSolana() {
  const rpcUrl = process.env.SOLANA_DEVNET_PROVISION_RPC_URL || 'https://api.devnet.solana.com'
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: process.env.SOLANA_DEVNET_PROVISION_WS_URL || 'wss://api.devnet.solana.com',
  })
  const payer = readSolanaKeypair()
  const balance = await connection.getBalance(payer.publicKey)

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.warn(`Solana payer balance is low: ${balance / LAMPORTS_PER_SOL} SOL`)
  }

  const envLines: string[] = []
  for (const asset of SOLANA_ASSETS) {
    const mint = await createMint(
      connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      asset.decimals
    )
    const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey)
    const amount = BigInt(asset.initialUiAmount) * (10n ** BigInt(asset.decimals))
    await mintTo(connection, payer, mint, ata.address, payer.publicKey, amount)

    envLines.push(`NEXT_PUBLIC_${asset.symbol}_MINT=${mint.toBase58()}`)
    console.log(`${asset.symbol} Solana devnet mint: ${mint.toBase58()}`)
  }

  return envLines
}

async function provisionStellar() {
  const server = new Horizon.Server('https://horizon-testnet.stellar.org')
  const distributor = StellarKeypair.random()
  const custody = StellarKeypair.random()
  await fundStellarTestAccount(distributor.publicKey())
  await fundStellarTestAccount(custody.publicKey())

  const envLines: string[] = [
    'NEXT_PUBLIC_STELLAR_CAPSULE_ORIGIN_ENABLED=true',
    `NEXT_PUBLIC_STELLAR_CUSTODY_PUBLIC_KEY=${custody.publicKey()}`,
    `STELLAR_CUSTODY_PUBLIC_KEY=${custody.publicKey()}`,
    `STELLAR_CUSTODY_SECRET_KEY=${custody.secret()}`,
    `STELLAR_DISTRIBUTOR_PUBLIC_KEY=${distributor.publicKey()}`,
    `STELLAR_DISTRIBUTOR_SECRET_KEY=${distributor.secret()}`,
  ]
  for (const asset of STELLAR_ASSETS) {
    const issuer = StellarKeypair.random()
    await fundStellarTestAccount(issuer.publicKey())

    const stellarAsset = new Asset(asset.symbol, issuer.publicKey())
    const distributorAccount = await server.loadAccount(distributor.publicKey())
    const trustTx = new TransactionBuilder(distributorAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset: stellarAsset }))
      .setTimeout(60)
      .build()
    trustTx.sign(distributor)
    await server.submitTransaction(trustTx)

    const custodyAccount = await server.loadAccount(custody.publicKey())
    const custodyTrustTx = new TransactionBuilder(custodyAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset: stellarAsset }))
      .setTimeout(60)
      .build()
    custodyTrustTx.sign(custody)
    await server.submitTransaction(custodyTrustTx)

    const issuerAccount = await server.loadAccount(issuer.publicKey())
    const paymentTx = new TransactionBuilder(issuerAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({
        destination: distributor.publicKey(),
        asset: stellarAsset,
        amount: asset.symbol === 'AUDD' ? '100000' : '1000',
      }))
      .setTimeout(60)
      .build()
    paymentTx.sign(issuer)
    await server.submitTransaction(paymentTx)

    envLines.push(`NEXT_PUBLIC_STELLAR_${asset.symbol}_CODE=${asset.symbol}`)
    envLines.push(`NEXT_PUBLIC_STELLAR_${asset.symbol}_ISSUER=${issuer.publicKey()}`)
    envLines.push(`STELLAR_${asset.symbol}_ISSUER_SECRET_KEY=${issuer.secret()}`)
    console.log(`${asset.symbol} Stellar testnet issuer: ${issuer.publicKey()}`)
  }

  console.log(`Stellar testnet distributor: ${distributor.publicKey()}`)
  console.log(`Stellar testnet custody: ${custody.publicKey()}`)
  return envLines
}

function upsertEnvFile(envLines: string[]) {
  const envPath = path.join(process.cwd(), '.env.local')
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const entries = new Map<string, string>()
  existing.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (match) entries.set(match[1], match[2])
  })
  envLines.forEach((line) => {
    const [key, ...valueParts] = line.split('=')
    entries.set(key, valueParts.join('='))
  })

  const existingKeys = new Set(entries.keys())
  const preservedLines = existing
    .split(/\r?\n/)
    .filter((line) => {
      const key = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1]
      return !key || !existingKeys.has(key)
    })
    .filter((line) => line.trim() || line.startsWith('#'))
  const nextLines = [
    ...preservedLines,
    ...Array.from(entries.entries()).map(([key, value]) => `${key}=${value}`),
  ]
  fs.writeFileSync(envPath, `${nextLines.join('\n')}\n`)
}

function printEnvLines(envLines: string[], showSecrets: boolean) {
  console.log('\nAdd these values to .env.local:\n')
  envLines.forEach((line) => {
    const key = line.split('=')[0]
    if (SECRET_ENV_KEYS.has(key) && !showSecrets) {
      console.log(`${key}=<generated secret>`)
      return
    }
    console.log(line)
  })
}

async function main() {
  const mode = process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1] || 'all'
  const writeEnv = process.argv.includes('--write-env')
  const showSecrets = process.argv.includes('--show-secrets')
  const envLines: string[] = []

  if (mode === 'all' || mode === 'solana') {
    envLines.push(...await provisionSolana())
  }
  if (mode === 'all' || mode === 'stellar') {
    envLines.push(...await provisionStellar())
  }

  if (writeEnv) {
    upsertEnvFile(envLines)
    console.log('\n.env.local updated with generated devnet/testnet assets.')
  } else {
    printEnvLines(envLines, showSecrets)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

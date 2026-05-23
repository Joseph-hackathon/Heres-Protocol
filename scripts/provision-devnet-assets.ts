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
  const rpcUrl = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com'
  const connection = new Connection(rpcUrl, 'confirmed')
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
  await fundStellarTestAccount(distributor.publicKey())

  const envLines: string[] = []
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
    console.log(`${asset.symbol} Stellar testnet issuer: ${issuer.publicKey()}`)
  }

  console.log(`Stellar testnet distributor: ${distributor.publicKey()}`)
  console.log(`Stellar testnet distributor secret: ${distributor.secret()}`)
  return envLines
}

async function main() {
  const mode = process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1] || 'all'
  const envLines: string[] = []

  if (mode === 'all' || mode === 'solana') {
    envLines.push(...await provisionSolana())
  }
  if (mode === 'all' || mode === 'stellar') {
    envLines.push(...await provisionStellar())
  }

  console.log('\nAdd these values to .env.local:\n')
  console.log(envLines.join('\n'))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

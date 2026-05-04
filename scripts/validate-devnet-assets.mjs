import fs from 'node:fs'
import path from 'node:path'

const envPath = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

const endpoint = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'

const assets = [
  { symbol: 'BTC', mint: process.env.NEXT_PUBLIC_BTC_DEVNET_MINT || '' },
  { symbol: 'ETH', mint: process.env.NEXT_PUBLIC_ETH_DEVNET_MINT || '' },
].filter((asset) => asset.mint)

if (assets.length === 0) {
  console.log('No non-native devnet asset mints configured.')
  process.exit(0)
}

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getMultipleAccounts',
    params: [assets.map((asset) => asset.mint), { encoding: 'jsonParsed' }],
  }),
})

if (!response.ok) {
  console.error(`RPC request failed: ${response.status}`)
  process.exit(1)
}

const payload = await response.json()
const values = payload?.result?.value

if (!Array.isArray(values)) {
  console.error('Unexpected RPC response payload')
  process.exit(1)
}

let hasFailure = false
for (const [index, account] of values.entries()) {
  const asset = assets[index]
  const exists = Boolean(account)
  const decimals = account?.data?.parsed?.info?.decimals
  console.log(`${asset.symbol}: mint=${asset.mint} exists=${exists}${exists ? ` decimals=${decimals}` : ''}`)
  if (!exists) hasFailure = true
}

if (hasFailure) process.exit(1)

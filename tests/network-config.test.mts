import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getAssetMintEnvKey,
  getAssetMintFromEnv,
  getExplorerUrl,
  getNetworkDisplayLabel,
} from '../constants/index.ts'

test('getExplorerUrl omits cluster for mainnet-beta and includes it elsewhere', () => {
  assert.equal(
    getExplorerUrl('tx', 'abc123', 'mainnet-beta'),
    'https://explorer.solana.com/tx/abc123'
  )
  assert.equal(
    getExplorerUrl('address', 'capsule123', 'devnet'),
    'https://explorer.solana.com/address/capsule123?cluster=devnet'
  )
})

test('network display labels map cleanly to Solana cluster names', () => {
  assert.equal(getNetworkDisplayLabel('mainnet-beta'), 'Solana Mainnet')
  assert.equal(getNetworkDisplayLabel('testnet'), 'Solana Testnet')
  assert.equal(getNetworkDisplayLabel('devnet'), 'Solana Devnet')
})

test('generic asset mint envs override legacy devnet-specific keys', () => {
  process.env.NEXT_PUBLIC_BTC_MINT = 'generic-mint'
  process.env.NEXT_PUBLIC_BTC_DEVNET_MINT = 'legacy-mint'

  assert.equal(getAssetMintEnvKey('BTC'), 'NEXT_PUBLIC_BTC_MINT')
  assert.equal(getAssetMintFromEnv('BTC'), 'generic-mint')

  delete process.env.NEXT_PUBLIC_BTC_MINT
  delete process.env.NEXT_PUBLIC_BTC_DEVNET_MINT
})

test('legacy asset mint envs still work when generic envs are absent', () => {
  process.env.NEXT_PUBLIC_ETH_DEVNET_MINT = 'legacy-eth-mint'

  assert.equal(getAssetMintFromEnv('ETH'), 'legacy-eth-mint')

  delete process.env.NEXT_PUBLIC_ETH_DEVNET_MINT
})

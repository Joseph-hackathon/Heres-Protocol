import assert from 'node:assert/strict'
import test from 'node:test'
import { PublicKey } from '@solana/web3.js'
import { getCapsuleFundingAssets } from '../lib/capsule-funding.ts'
import { ataFor, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '../lib/spl.ts'

const owner = new PublicKey('11111111111111111111111111111111')
const fungibleMint = new PublicKey('So11111111111111111111111111111111111111112')
const nftMint = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So')
const wholeUnitMint = new PublicKey('SysvarC1ock11111111111111111111111111111111')

function parsedTokenAccount(
  pubkey: PublicKey,
  mint: PublicKey,
  amount: string,
  decimals: number
) {
  return {
    pubkey,
    account: {
      data: {
        parsed: {
          info: {
            mint: mint.toBase58(),
            tokenAmount: { amount, decimals },
          },
        },
      },
    },
  }
}

test('capsule funding lists SOL and canonical fungible mints while excluding NFTs', async () => {
  const classicFungibleAta = ataFor(fungibleMint, owner, TOKEN_PROGRAM_ID)
  const nftAta = ataFor(nftMint, owner, TOKEN_PROGRAM_ID)
  const wholeUnitAta = ataFor(wholeUnitMint, owner, TOKEN_2022_PROGRAM_ID)

  const connection = {
    getBalance: async () => 2_500_000_000,
    getParsedTokenAccountsByOwner: async (_owner: PublicKey, filter: { programId: PublicKey }) => ({
      value: filter.programId.equals(TOKEN_PROGRAM_ID)
        ? [
            parsedTokenAccount(classicFungibleAta, fungibleMint, '12340000', 6),
            parsedTokenAccount(nftAta, nftMint, '1', 0),
            // Deposits use the canonical ATA, so a second arbitrary token account is not selectable.
            parsedTokenAccount(PublicKey.unique(), fungibleMint, '5000000', 6),
          ]
        : [parsedTokenAccount(wholeUnitAta, wholeUnitMint, '7', 0)],
    }),
    getTokenSupply: async (mint: PublicKey) => ({
      value: mint.equals(nftMint)
        ? { amount: '1', decimals: 0 }
        : { amount: '1000000', decimals: 0 },
    }),
  }

  const assets = await getCapsuleFundingAssets(connection as any, owner)

  assert.deepEqual(assets.map((asset) => asset.id), [
    'sol',
    fungibleMint.toBase58(),
    wholeUnitMint.toBase58(),
  ])
  assert.equal(assets[0].balance, 2_500_000_000n)
  assert.equal(assets[1].balance, 12_340_000n)
  assert.equal(assets[2].balance, 7n)
})

test('capsule funding hides an unverifiable zero-decimal mint', async () => {
  const ata = ataFor(nftMint, owner, TOKEN_PROGRAM_ID)
  const connection = {
    getBalance: async () => 1,
    getParsedTokenAccountsByOwner: async (_owner: PublicKey, filter: { programId: PublicKey }) => ({
      value: filter.programId.equals(TOKEN_PROGRAM_ID)
        ? [parsedTokenAccount(ata, nftMint, '1', 0)]
        : [],
    }),
    getTokenSupply: async () => {
      throw new Error('RPC unavailable')
    },
  }

  const assets = await getCapsuleFundingAssets(connection as any, owner)
  assert.deepEqual(assets.map((asset) => asset.id), ['sol'])
})

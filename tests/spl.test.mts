import test from 'node:test'
import assert from 'node:assert/strict'
import { PublicKey } from '@solana/web3.js'
import {
  ataFor,
  getVaultTokenAccounts,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '../lib/spl.ts'

const owner = new PublicKey('11111111111111111111111111111111')
const classicMint = new PublicKey('So11111111111111111111111111111111111111112')
const token2022Mint = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So')

function parsedTokenAccount(
  mint: PublicKey,
  amount: string,
  decimals: number,
  tokenProgram: PublicKey,
  pubkey = ataFor(mint, owner, tokenProgram)
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

test('vault token scan includes classic SPL and Token-2022 accounts', async () => {
  const scannedPrograms: string[] = []
  const connection = {
    getParsedTokenAccountsByOwner: async (_owner: PublicKey, filter: { programId: PublicKey }) => {
      scannedPrograms.push(filter.programId.toBase58())
      return {
        value: filter.programId.equals(TOKEN_PROGRAM_ID)
          ? [parsedTokenAccount(classicMint, '10', 9, TOKEN_PROGRAM_ID)]
          : [parsedTokenAccount(token2022Mint, '1', 0, TOKEN_2022_PROGRAM_ID)],
      }
    },
  }

  const accounts = await getVaultTokenAccounts(connection as any, owner)

  assert.deepEqual(scannedPrograms, [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()])
  assert.deepEqual(accounts.map((account) => account.amount), [10n, 1n])
  assert.equal(accounts[1].tokenProgram.equals(TOKEN_2022_PROGRAM_ID), true)
})

test('vault token scan ignores noncanonical accounts controlled by the vault PDA', async () => {
  const connection = {
    getParsedTokenAccountsByOwner: async (_owner: PublicKey, filter: { programId: PublicKey }) => ({
      value: filter.programId.equals(TOKEN_PROGRAM_ID)
        ? [
            parsedTokenAccount(classicMint, '10', 9, TOKEN_PROGRAM_ID),
            parsedTokenAccount(classicMint, '5', 9, TOKEN_PROGRAM_ID, PublicKey.unique()),
          ]
        : [],
    }),
  }

  const accounts = await getVaultTokenAccounts(connection as any, owner)

  assert.equal(accounts.length, 1)
  assert.equal(accounts[0].amount, 10n)
})

test('vault token scan propagates RPC errors instead of treating the vault as drained', async () => {
  const connection = {
    getParsedTokenAccountsByOwner: async () => {
      throw new Error('RPC unavailable')
    },
  }

  await assert.rejects(getVaultTokenAccounts(connection as any, owner), /RPC unavailable/)
})

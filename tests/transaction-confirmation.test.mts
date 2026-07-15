import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmTransactionOrThrow } from '../lib/transaction-confirmation.ts'

const strategy = {
  signature: 'test-signature',
  blockhash: 'test-blockhash',
  lastValidBlockHeight: 123,
}

test('confirmed transaction without an instruction error resolves', async () => {
  const connection = {
    confirmTransaction: async () => ({ context: { slot: 1 }, value: { err: null } }),
    getTransaction: async () => {
      throw new Error('getTransaction must not run for successful confirmations')
    },
  }

  await assert.doesNotReject(confirmTransactionOrThrow(connection as any, strategy))
})

test('confirmed transaction with an instruction error rejects instead of reporting success', async () => {
  const connection = {
    confirmTransaction: async () => ({
      context: { slot: 1 },
      value: { err: { InstructionError: [1, { Custom: 6007 }] } },
    }),
    getTransaction: async () => ({
      meta: {
        logMessages: [
          'Program log: Instruction: DistributeNft',
          'Program log: AnchorError thrown in distribute_nft.rs. Error Code: GracePeriodNotElapsed.',
        ],
      },
    }),
  }

  await assert.rejects(
    confirmTransactionOrThrow(connection as any, strategy),
    /Transaction test-signature failed: AnchorError.*GracePeriodNotElapsed/
  )
})

test('failed confirmation falls back to the structured Solana error when logs are unavailable', async () => {
  const connection = {
    confirmTransaction: async () => ({
      context: { slot: 1 },
      value: { err: { InstructionError: [2, 'InvalidAccountData'] } },
    }),
    getTransaction: async () => null,
  }

  await assert.rejects(
    confirmTransactionOrThrow(connection as any, strategy),
    /InstructionError.*InvalidAccountData/
  )
})

test('failed confirmation surfaces a generic program failure log', async () => {
  const connection = {
    confirmTransaction: async () => ({
      context: { slot: 1 },
      value: { err: { InstructionError: [0, 'InvalidAccountData'] } },
    }),
    getTransaction: async () => ({
      meta: {
        logMessages: ['Program Example111111111111111111111111111111111 failed: invalid account data'],
      },
    }),
  }

  await assert.rejects(
    confirmTransactionOrThrow(connection as any, strategy),
    /failed: Program Example.*failed: invalid account data/
  )
})

test('failed confirmation preserves the structured error when transaction logs cannot be fetched', async () => {
  const connection = {
    confirmTransaction: async () => ({
      context: { slot: 1 },
      value: { err: { InstructionError: [3, { Custom: 6013 }] } },
    }),
    getTransaction: async () => {
      throw new Error('RPC unavailable')
    },
  }

  await assert.rejects(confirmTransactionOrThrow(connection as any, strategy), /Custom.*6013/)
})

test('finalized confirmation uses finalized transaction logs', async () => {
  let confirmationCommitment = ''
  let transactionCommitment = ''
  const connection = {
    confirmTransaction: async (_strategy: unknown, commitment: string) => {
      confirmationCommitment = commitment
      return {
        context: { slot: 1 },
        value: { err: { InstructionError: [0, 'InvalidAccountData'] } },
      }
    },
    getTransaction: async (_signature: string, config: { commitment: string }) => {
      transactionCommitment = config.commitment
      return null
    },
  }

  await assert.rejects(confirmTransactionOrThrow(connection as any, strategy, 'finalized'))
  assert.equal(confirmationCommitment, 'finalized')
  assert.equal(transactionCommitment, 'finalized')
})

import type {
  BlockheightBasedTransactionConfirmationStrategy,
  Commitment,
  Connection,
  Finality,
  SignatureResult,
} from '@solana/web3.js'

type ConfirmationConnection = Pick<Connection, 'confirmTransaction' | 'getTransaction'>

function formatTransactionFailure(signature: string, result: SignatureResult, logs: string[]): string {
  const anchorError = logs.find((line) => line.includes('AnchorError'))
  if (anchorError) {
    return `Transaction ${signature} failed: ${anchorError.replace(/^Program log:\s*/, '')}`
  }

  const programFailure = logs.find((line) => line.includes('failed:'))
  if (programFailure) {
    return `Transaction ${signature} failed: ${programFailure.replace(/^Program log:\s*/, '')}`
  }

  return `Transaction ${signature} failed: ${JSON.stringify(result.err)}`
}

/** Confirm a base-layer transaction and reject when Solana records an instruction error. */
export async function confirmTransactionOrThrow(
  connection: ConfirmationConnection,
  strategy: BlockheightBasedTransactionConfirmationStrategy,
  commitment: Commitment = 'confirmed'
): Promise<void> {
  const conn = connection as any
  if (typeof conn.getSignatureStatuses === 'function') {
    const start = Date.now()
    while (Date.now() - start < 30_000) {
      await new Promise((r) => setTimeout(r, 800))
      const res = await conn.getSignatureStatuses([strategy.signature])
      const s = res?.value?.[0]
      if (s) {
        if (s.err) {
          throw new Error(`Transaction ${strategy.signature} failed: ${JSON.stringify(s.err)}`)
        }
        if (['confirmed', 'finalized'].includes(s.confirmationStatus ?? '')) {
          return
        }
      }
    }
  }

  const confirmation = await connection.confirmTransaction(strategy, commitment)
  if (!confirmation.value.err) return

  const transactionCommitment: Finality = commitment === 'finalized' ? 'finalized' : 'confirmed'
  const transaction = await connection
    .getTransaction(strategy.signature, {
      commitment: transactionCommitment,
      maxSupportedTransactionVersion: 0,
    })
    .catch(() => null)
  const logs = transaction?.meta?.logMessages ?? []
  const error = new Error(formatTransactionFailure(strategy.signature, confirmation.value, logs))
  Object.assign(error, { signature: strategy.signature, logs, transactionError: confirmation.value.err })
  throw error
}
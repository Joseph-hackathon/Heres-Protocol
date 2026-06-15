/**
 * Single transaction-error normalizer. Replaces the ~70 ad-hoc
 * `err.message.includes(...)` sites scattered across the pages with one
 * mapping from raw wallet/RPC/program errors to a human sentence.
 *
 * Keep this purely about MESSAGES. Callers decide how to surface (toast,
 * inline) via useTxLifecycle / useToast.
 */

function rawMessage(err: unknown): string {
  if (err == null) return ''
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const anyErr = err as { message?: unknown; error?: { message?: unknown } }
    if (typeof anyErr.message === 'string') return anyErr.message
    if (typeof anyErr.error?.message === 'string') return anyErr.error.message
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}

/** Returns a friendly, user-facing message for a transaction/RPC failure. */
export function normalizeTxError(err: unknown): string {
  const raw = rawMessage(err)
  const lower = raw.toLowerCase()

  // Wallet rejection (Phantom/Solflare/standard wallet adapter).
  if (
    lower.includes('user rejected') ||
    lower.includes('user denied') ||
    lower.includes('rejected the request') ||
    lower.includes('4001')
  ) {
    return 'You rejected the request in your wallet.'
  }

  // Insufficient funds. 0x1 is the SystemProgram insufficient-lamports code.
  if (
    lower.includes('insufficient') ||
    lower.includes('0x1 ') ||
    lower.endsWith('0x1') ||
    lower.includes('attempt to debit an account but found no record')
  ) {
    return 'Insufficient balance to complete this transaction.'
  }

  // Blockhash expiry / stale transaction.
  if (lower.includes('blockhash') || lower.includes('block height exceeded')) {
    return 'The transaction expired before confirming. Please try again.'
  }

  // Simulation failures surface the program log; keep it but make it readable.
  if (lower.includes('simulation failed') || lower.includes('transaction simulation')) {
    const custom = raw.match(/custom program error: (0x[0-9a-fA-F]+)/)
    if (custom) {
      const code = parseInt(custom[1], 16)
      return `The program rejected this transaction (error ${code}).`
    }
    return 'The transaction failed simulation and was not sent.'
  }

  // Bare custom program error.
  const custom = raw.match(/custom program error: (0x[0-9a-fA-F]+)/)
  if (custom) {
    const code = parseInt(custom[1], 16)
    return `The program rejected this transaction (error ${code}).`
  }

  // Network / RPC reachability.
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network error') ||
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('429')
  ) {
    return 'Network error reaching the RPC. Please try again in a moment.'
  }

  // Wallet not connected / missing signer.
  if (lower.includes('wallet not connected') || lower.includes('no wallet')) {
    return 'Connect your wallet to continue.'
  }

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : 'Something went wrong. Please try again.'
}

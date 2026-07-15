import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type BlockheightBasedTransactionConfirmationStrategy,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAccountLenForMint,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token'
import type { HeresWallet } from '@/types/wallet'
import { getVaultTokenAccounts } from '@/lib/spl'
import { confirmTransactionOrThrow } from '@/lib/transaction-confirmation'

export type WalletTransferAsset =
  | {
      id: 'sol'
      kind: 'sol'
      balance: bigint
      decimals: 9
    }
  | {
      id: string
      kind: 'spl'
      balance: bigint
      decimals: number
      mint: PublicKey
      sourceTokenAccount: PublicKey
      tokenProgram: PublicKey
    }

export interface WalletTransferRequest {
  sender: PublicKey
  recipient: PublicKey
  amount: bigint
  asset: WalletTransferAsset
}

export interface WalletTransferQuote {
  transaction: Transaction
  strategy: BlockheightBasedTransactionConfirmationStrategy
  networkFeeLamports: number
  recipientAccountRentLamports: number
  senderBalanceLamports: number
}

export async function getWalletTransferAssets(
  connection: Connection,
  owner: PublicKey
): Promise<WalletTransferAsset[]> {
  const [lamports, tokenAccounts] = await Promise.all([
    connection.getBalance(owner, 'confirmed'),
    getVaultTokenAccounts(connection, owner),
  ])

  return [
    { id: 'sol', kind: 'sol', balance: BigInt(lamports), decimals: 9 },
    ...tokenAccounts
      .filter((account) => account.amount > 0n)
      .map((account) => ({
        id: `spl:${account.ata.toBase58()}`,
        kind: 'spl' as const,
        balance: account.amount,
        decimals: account.decimals,
        mint: account.mint,
        sourceTokenAccount: account.ata,
        tokenProgram: account.tokenProgram,
      })),
  ]
}

export async function buildWalletTransfer(
  connection: Connection,
  request: WalletTransferRequest
): Promise<WalletTransferQuote> {
  const { sender, recipient, amount, asset } = request
  if (amount <= 0n) throw new Error('Enter an amount greater than zero.')
  if (sender.equals(recipient)) throw new Error('The recipient must be a different wallet.')

  const [{ blockhash, lastValidBlockHeight }, senderBalanceLamports] = await Promise.all([
    connection.getLatestBlockhash('confirmed'),
    connection.getBalance(sender, 'confirmed'),
  ])
  const transaction = new Transaction({ feePayer: sender, blockhash, lastValidBlockHeight })
  let recipientAccountRentLamports = 0

  if (asset.kind === 'sol') {
    transaction.add(SystemProgram.transfer({ fromPubkey: sender, toPubkey: recipient, lamports: amount }))
  } else {
    const source = await getAccount(
      connection,
      asset.sourceTokenAccount,
      'confirmed',
      asset.tokenProgram
    )
    if (!source.owner.equals(sender) || !source.mint.equals(asset.mint)) {
      throw new Error('The selected token account is no longer controlled by this wallet.')
    }
    if (amount > source.amount) throw new Error('The amount exceeds the selected token balance.')

    const recipientTokenAccount = getAssociatedTokenAddressSync(
      asset.mint,
      recipient,
      true,
      asset.tokenProgram
    )
    const recipientInfo = await connection.getAccountInfo(recipientTokenAccount, 'confirmed')
    if (!recipientInfo) {
      const mint = await getMint(connection, asset.mint, 'confirmed', asset.tokenProgram)
      recipientAccountRentLamports = await connection.getMinimumBalanceForRentExemption(
        getAccountLenForMint(mint),
        'confirmed'
      )
      transaction.add(
        createAssociatedTokenAccountIdempotentInstruction(
          sender,
          recipientTokenAccount,
          recipient,
          asset.mint,
          asset.tokenProgram
        )
      )
    } else {
      const destination = await getAccount(
        connection,
        recipientTokenAccount,
        'confirmed',
        asset.tokenProgram
      )
      if (!destination.owner.equals(recipient) || !destination.mint.equals(asset.mint)) {
        throw new Error('The recipient token account is invalid for this mint.')
      }
    }

    transaction.add(
      createTransferCheckedInstruction(
        asset.sourceTokenAccount,
        asset.mint,
        recipientTokenAccount,
        sender,
        amount,
        asset.decimals,
        [],
        asset.tokenProgram
      )
    )
  }

  const fee = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed')
  if (fee.value == null) throw new Error('Could not estimate the Solana network fee.')

  const requiredLamports = BigInt(fee.value + recipientAccountRentLamports) +
    (asset.kind === 'sol' ? amount : 0n)
  if (BigInt(senderBalanceLamports) < requiredLamports) {
    throw new Error('Insufficient SOL for the transfer and network costs.')
  }

  return {
    transaction,
    strategy: { signature: '', blockhash, lastValidBlockHeight },
    networkFeeLamports: fee.value,
    recipientAccountRentLamports,
    senderBalanceLamports,
  }
}

export async function simulateWalletTransfer(
  connection: Connection,
  quote: WalletTransferQuote
): Promise<void> {
  const simulation = await connection.simulateTransaction(quote.transaction)
  if (!simulation.value.err) return

  const error = new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`)
  Object.assign(error, { logs: simulation.value.logs ?? [] })
  throw error
}

export async function estimateMaxSolTransfer(
  connection: Connection,
  sender: PublicKey,
  recipient: PublicKey
): Promise<bigint> {
  const quote = await buildWalletTransfer(connection, {
    sender,
    recipient,
    amount: 1n,
    asset: { id: 'sol', kind: 'sol', balance: 0n, decimals: 9 },
  })
  const max = BigInt(quote.senderBalanceLamports) - BigInt(quote.networkFeeLamports)
  return max > 0n ? max : 0n
}

export async function sendWalletTransfer(
  connection: Connection,
  wallet: HeresWallet,
  request: WalletTransferRequest
): Promise<{ signature: string; quote: WalletTransferQuote }> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected.')

  const quote = await buildWalletTransfer(connection, request)
  await simulateWalletTransfer(connection, quote)
  const signed = await wallet.signTransaction(quote.transaction)
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  })
  await confirmTransactionOrThrow(connection, { ...quote.strategy, signature }, 'confirmed')
  return { signature, quote }
}

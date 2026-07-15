import type { Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { ataFor, getVaultTokenAccounts } from './spl.ts'

export type CapsuleFundingAsset =
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
      tokenProgram: PublicKey
    }

/**
 * List assets that can be added to an existing fungible capsule.
 *
 * Deposits always spend from the owner's canonical ATA, so non-canonical token accounts are omitted.
 * A decimals-0, supply-1 mint is an NFT and must not enter this proportional fungible path because it
 * needs an explicit recipient in the sealed inheritance configuration.
 */
export async function getCapsuleFundingAssets(
  connection: Connection,
  owner: PublicKey
): Promise<CapsuleFundingAsset[]> {
  const [lamports, tokenAccounts] = await Promise.all([
    connection.getBalance(owner, 'confirmed'),
    getVaultTokenAccounts(connection, owner),
  ])

  const canonicalTokens = tokenAccounts.filter(
    (account) =>
      account.amount > 0n &&
      account.ata.equals(ataFor(account.mint, owner, account.tokenProgram))
  )

  const fungibleTokens = await Promise.all(
    canonicalTokens.map(async (account): Promise<CapsuleFundingAsset | null> => {
      if (account.decimals === 0) {
        // If supply cannot be verified, keep the mint out of the fungible selector. Accidentally
        // treating an NFT as proportional money is worse than asking the user to retry the read.
        const supply = await connection.getTokenSupply(account.mint, 'confirmed').catch(() => null)
        if (!supply || (supply.value.decimals === 0 && supply.value.amount === '1')) return null
      }

      return {
        id: account.mint.toBase58(),
        kind: 'spl',
        balance: account.amount,
        decimals: account.decimals,
        mint: account.mint,
        tokenProgram: account.tokenProgram,
      }
    })
  )

  return [
    { id: 'sol', kind: 'sol', balance: BigInt(lamports), decimals: 9 },
    ...fungibleTokens.filter((asset): asset is CapsuleFundingAsset => asset !== null),
  ]
}

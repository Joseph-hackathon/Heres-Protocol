/**
 * Token-program-aware SPL helpers. The vault accepts BOTH the classic SPL Token program and Token-2022
 * (the on-chain instructions use anchor_spl::token_interface). Token-2022 ATAs derive with the
 * Token-2022 program id, so every off-chain ATA derivation / account passing must use the mint's actual
 * owning program - never a hardcoded TOKEN_PROGRAM_ID.
 */
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

/** Program-aware associated token address. Pass the mint's owning token program (classic or 2022). */
export function ataFor(mint: PublicKey, owner: PublicKey, tokenProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0]
}

/** Read a mint's owning token program from chain. Throws if it is not a known token program. */
export async function resolveTokenProgram(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint)
  if (!info) throw new Error(`Mint ${mint.toBase58()} not found`)
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID
  throw new Error(`Mint ${mint.toBase58()} is not owned by a supported token program`)
}

/** Build the create-ATA instruction for the given token program (idempotent create handled by caller). */
export function buildCreateAtaIx(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  })
}

export type VaultTokenAccount = {
  ata: PublicKey
  mint: PublicKey
  amount: bigint
  decimals: number
  tokenProgram: PublicKey
}

/**
 * Enumerate every SPL asset held by an account, scanning BOTH token programs. A vault may hold classic
 * SPL and Token-2022 assets simultaneously, so distribution/recovery must look at both.
 */
export async function getVaultTokenAccounts(
  connection: Connection,
  owner: PublicKey
): Promise<VaultTokenAccount[]> {
  const out: VaultTokenAccount[] = []
  for (const tokenProgram of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await connection.getParsedTokenAccountsByOwner(owner, { programId: tokenProgram })
    for (const { pubkey, account } of res.value) {
      const info = (account.data as any).parsed?.info
      if (!info) continue
      out.push({
        ata: pubkey,
        mint: new PublicKey(info.mint),
        amount: BigInt(info.tokenAmount.amount),
        decimals: Number(info.tokenAmount.decimals),
        tokenProgram,
      })
    }
  }
  return out
}

import { NextRequest, NextResponse } from 'next/server'
import { Keypair, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { getSolanaConnection } from '@/config/solana'
import { MAGICBLOCK_ER } from '@/constants'
import { fetchCapsuleStateByAddress } from '@/lib/cre/solana'
import { getCapsuleVaultPDA } from '@/lib/program'
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor'
import idl from '@/idl/HeresProgram.json'

function getCrankKeypair(): Keypair | null {
  const raw = process.env.CRANK_WALLET_PRIVATE_KEY
  if (!raw || raw.length < 32) return null
  try {
    if (raw.startsWith('[')) {
      const arr = JSON.parse(raw) as number[]
      if (arr.length !== 64) return null
      return Keypair.fromSecretKey(Uint8Array.from(arr))
    }
    if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(raw)) {
      return Keypair.fromSecretKey(bs58.decode(raw))
    }
    return Keypair.fromSecretKey(Buffer.from(raw, 'base64'))
  } catch {
    return null
  }
}

function makeWallet(keypair: Keypair): Wallet {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async (tx) => {
      tx.sign([keypair] as any)
      return tx
    },
    signAllTransactions: async (txs) => {
      return txs.map((tx) => {
        tx.sign([keypair] as any)
        return tx
      })
    },
  } as Wallet
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

async function handle(request: NextRequest) {
  const auth = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || !secret.trim()) {
    return NextResponse.json({ error: 'CRON_SECRET is required' }, { status: 503 })
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const keypair = getCrankKeypair()
  if (!keypair) {
    return NextResponse.json({ error: 'CRANK_WALLET_PRIVATE_KEY not set or invalid' }, { status: 500 })
  }

  try {
    const connection = getSolanaConnection()
    const wallet = makeWallet(keypair)
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
    const program = new Program(idl as any, provider)

    // Use low-level getProgramAccounts to fetch all capsule accounts without typed account access
    const programId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || 'AmiL7vEZ2SpAuDXzdxC3sJMyjZqgacvwvvQdT3qosmsW')
    const accounts = await connection.getProgramAccounts(programId) // no filters

    const delegationProgramId = new PublicKey(MAGICBLOCK_ER.DELEGATION_PROGRAM_ID)
    const undelegated: string[] = []
    const skipped: string[] = []
    const errors: string[] = []

    for (const acct of accounts) {
      const pubkey = acct.pubkey
      const accountInfo = acct.account

      // Check if delegated to ER (owner is delegation program)
      if (!accountInfo.owner.equals(delegationProgramId)) {
        skipped.push(pubkey.toBase58())
        continue
      }

      // Check if executed
      try {
        const decoded = await fetchCapsuleStateByAddress(pubkey)
        if (!decoded) {
          skipped.push(pubkey.toBase58())
          continue
        }
        if (decoded.executedAt === null) {
          skipped.push(pubkey.toBase58() + ' (not executed)')
          continue
        }
      } catch (e) {
        skipped.push(pubkey.toBase58() + ' (decode error)')
        continue
      }

      // Call crank_undelegate via program
      try {
        // Need to get owner from account data to derive vault PDA
        const decoded = await fetchCapsuleStateByAddress(pubkey)
        if (!decoded) {
          errors.push(`${pubkey.toBase58()}: could not decode`)
          continue
        }
        const ownerPubkey = decoded.owner
        const [vaultPDA] = getCapsuleVaultPDA(ownerPubkey)
        const magicProgramId = new PublicKey(MAGICBLOCK_ER.MAGIC_PROGRAM_ID)
        const magicContextId = new PublicKey(MAGICBLOCK_ER.MAGIC_CONTEXT)

        const tx = await program.methods
          .crankUndelegate()
          .accounts({
            payer: keypair.publicKey,
            capsule: pubkey,
            vault: vaultPDA,
            magicContext: magicContextId,
            magicProgram: magicProgramId,
          })
          .rpc()

        undelegated.push(`${pubkey.toBase58()} (sig: ${tx})`)
      } catch (error: any) {
        errors.push(`${pubkey.toBase58()}: ${error.message}`)
      }
    }

    return NextResponse.json({
      ok: true,
      total: accounts.length,
      undelegated: undelegated.length,
      skipped: skipped.length,
      errors: errors.length,
      undelegatedList: undelegated,
      skippedList: skipped,
      errorList: errors,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

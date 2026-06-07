/**
 * E2E helper: create ONE base-layer test capsule (no ER delegation) for the Model A sweep test.
 * Fresh ephemeral owner (funded from the deploy wallet), short inactivity so it elapses fast,
 * beneficiary = crank wallet (self-contained, funds return to a wallet we control).
 *
 * Prints the owner pubkey on the last line (machine-readable) so the orchestrator can register it.
 *
 * Usage: node scripts/e2e-create-test-capsule.mjs [inactivitySeconds] [totalAmountSol]
 */
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import anchor from '@coral-xyz/anchor'
const { AnchorProvider, Program, BN } = anchor
import { readFileSync } from 'fs'
import { homedir } from 'os'

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const FEE_RECIPIENT = new PublicKey('Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb')
const CRANK = new PublicKey('3XjbnUmCRfq6tHZCfXuDSMKoapyxj9pnkaJSTVRfcEqd') // beneficiary (self-contained)

const inactivity = Number(process.argv[2] || 10)
const totalAmountSol = process.argv[3] || '0.003'

const idl = JSON.parse(readFileSync(new URL('../idl/HeresProgram.json', import.meta.url), 'utf8'))
const PROGRAM_ID = new PublicKey(idl.address)

const load = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(homedir() + '/.config/solana/' + f, 'utf8'))))
const deploy = load('heres-deploy.json') // funder + fee authority
const owner = Keypair.generate()

const c = new Connection(RPC, 'confirmed')
const [capsulePDA] = PublicKey.findProgramAddressSync([Buffer.from('intent_capsule'), owner.publicKey.toBuffer()], PROGRAM_ID)
const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('capsule_vault'), owner.publicKey.toBuffer()], PROGRAM_ID)
const [feeCfgPDA] = PublicKey.findProgramAddressSync([Buffer.from('fee_config')], PROGRAM_ID)

console.error('owner:  ', owner.publicKey.toBase58())
console.error('capsule:', capsulePDA.toBase58())
console.error('vault:  ', vaultPDA.toBase58())
console.error('inactivity:', inactivity + 's', ' totalAmount:', totalAmountSol, 'SOL  beneficiary: crank')

// 1) Fund the ephemeral owner from the deploy wallet (creation fee 0.05 + locked + rent + fees).
const fund = 0.08 * 1e9
const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash('confirmed')
const ftx = new Transaction({ feePayer: deploy.publicKey, blockhash, lastValidBlockHeight })
ftx.add(SystemProgram.transfer({ fromPubkey: deploy.publicKey, toPubkey: owner.publicKey, lamports: fund }))
ftx.sign(deploy)
const fsig = await c.sendRawTransaction(ftx.serialize())
await c.confirmTransaction({ signature: fsig, blockhash, lastValidBlockHeight }, 'confirmed')
console.error('funded owner with 0.08 SOL')

// 2) Create the capsule (owner signs + pays). Base-only: no delegate, no ScheduleTask.
const wallet = {
  publicKey: owner.publicKey,
  payer: owner,
  signTransaction: async (tx) => { tx.sign(owner); return tx },
  signAllTransactions: async (txs) => { txs.forEach((t) => t.sign(owner)); return txs },
}
const provider = new AnchorProvider(c, wallet, { commitment: 'confirmed' })
const program = new Program(idl, provider)

const intent = JSON.stringify({
  intent: 'e2e-model-a-test',
  beneficiaries: [{ address: CRANK.toBase58(), amount: '100', amountType: 'percentage' }],
  totalAmount: totalAmountSol,
  inactivityDays: 0,
  delayDays: 0,
})

try {
  const sig = await program.methods
    .createCapsule(new BN(inactivity), Buffer.from(intent))
    .accounts({
      capsule: capsulePDA,
      vault: vaultPDA,
      owner: owner.publicKey,
      feeConfig: feeCfgPDA,
      platformFeeRecipient: FEE_RECIPIENT,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      mint: null,
      sourceTokenAccount: null,
      vaultTokenAccount: null,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc({ commitment: 'confirmed' })
  console.error('created capsule tx:', sig)
  const vbal = await c.getBalance(vaultPDA)
  console.error('vault balance:', (vbal / 1e9).toFixed(6), 'SOL')
} catch (e) {
  console.error('CREATE FAILED:', e.message)
  if (e.logs) e.logs.forEach((l) => console.error('  ', l))
  process.exit(1)
}

// machine-readable: owner pubkey on stdout (last line)
console.log(owner.publicKey.toBase58())

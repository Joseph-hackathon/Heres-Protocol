/**
 * Live-devnet proof that the vault accepts BOTH the classic SPL Token program AND Token-2022, via the
 * token_interface migration (deposit + recover_vault). The vault is never delegated, so this needs no
 * ER: create capsule (base) -> for each token program, mint a fresh token to the owner, deposit it,
 * assert the vault holds it, recover it, assert it returned. Distribution behavior is covered by
 * bankrun, so it is not exercised here.
 *
 * Run:  node scripts/magicblock/token2022-check.mjs
 */
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'
import anchor from '@coral-xyz/anchor'
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const { Program, AnchorProvider, BN, Wallet } = anchor
const REPO = join(homedir(), 'projects/heres-protocol')
const idl = JSON.parse(readFileSync(join(REPO, 'heres_program/target/idl/heres_program.json'), 'utf-8'))
const PROGRAM_ID = new PublicKey(idl.address)

function configBaseRpc() {
  try {
    const cfg = readFileSync(join(homedir(), '.config/solana/cli/config.yml'), 'utf-8')
    const m = cfg.match(/json_rpc_url:\s*"?([^"\s]+)"?/)
    if (m && /devnet/.test(m[1])) return m[1]
  } catch { /* fall through */ }
  return 'https://api.devnet.solana.com'
}
const loadKp = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf-8'))))
const sk = (p) => join(homedir(), '.config/solana', p)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const connection = new Connection(configBaseRpc(), 'confirmed')
const funder = loadKp(sk('id.json'))
const owner = Keypair.generate()
const provider = new AnchorProvider(connection, new Wallet(owner), { commitment: 'confirmed' })
const program = new Program(idl, provider)

const seed = (s) => Buffer.from(s)
const [capsule] = PublicKey.findProgramAddressSync([seed('intent_capsule'), owner.publicKey.toBuffer()], PROGRAM_ID)
const [benSet] = PublicKey.findProgramAddressSync([seed('beneficiary_set'), owner.publicKey.toBuffer()], PROGRAM_ID)
const [vault] = PublicKey.findProgramAddressSync([seed('capsule_vault'), owner.publicKey.toBuffer()], PROGRAM_ID)
const [feeConfig] = PublicKey.findProgramAddressSync([seed('fee_config')], PROGRAM_ID)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`)
}

const DECIMALS = 6
const MINT_AMOUNT = 1_000n * 10n ** BigInt(DECIMALS)
const DEPOSIT_AMOUNT = 250n * 10n ** BigInt(DECIMALS)

async function proveTokenProgram(label, tokenProgram) {
  console.log(`\n--- ${label} (${tokenProgram.toBase58()}) ---`)
  // fresh mint owned by this token program
  const mint = await createMint(connection, owner, owner.publicKey, null, DECIMALS, undefined, undefined, tokenProgram)
  const ownerAta = await getOrCreateAssociatedTokenAccount(connection, owner, mint, owner.publicKey, false, undefined, undefined, tokenProgram)
  await mintTo(connection, owner, mint, ownerAta.address, owner, MINT_AMOUNT, [], undefined, tokenProgram)
  check(`${label}: minted ${MINT_AMOUNT} to owner`, true, `mint ${mint.toBase58().slice(0, 8)}`)

  const vaultAta = getAssociatedTokenAddressSync(mint, vault, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID)
  const sourceAta = getAssociatedTokenAddressSync(mint, owner.publicKey, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID)

  // deposit
  await program.methods
    .deposit(new BN(DEPOSIT_AMOUNT.toString()))
    .accountsPartial({
      capsule, vault, owner: owner.publicKey, systemProgram: SystemProgram.programId,
      tokenProgram, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, mint,
      sourceTokenAccount: sourceAta, vaultTokenAccount: vaultAta,
    })
    .rpc()
  await sleep(1500)
  const vaultBal = (await getAccount(connection, vaultAta, 'confirmed', tokenProgram)).amount
  check(`${label}: deposit credited the vault`, vaultBal === DEPOSIT_AMOUNT, `vault=${vaultBal}`)

  // recover
  const ownerBefore = (await getAccount(connection, ownerAta.address, 'confirmed', tokenProgram)).amount
  await program.methods
    .recoverVault()
    .accountsPartial({
      capsule, vault, owner: owner.publicKey, systemProgram: SystemProgram.programId,
      tokenProgram, mint, vaultTokenAccount: vaultAta, ownerTokenAccount: ownerAta.address,
    })
    .rpc()
  await sleep(1500)
  const ownerAfter = (await getAccount(connection, ownerAta.address, 'confirmed', tokenProgram)).amount
  check(`${label}: recover returned funds to owner`, ownerAfter - ownerBefore === DEPOSIT_AMOUNT, `owner +${ownerAfter - ownerBefore}`)
  const vaultClosed = (await connection.getAccountInfo(vaultAta)) === null
  check(`${label}: vault ATA closed after recover`, vaultClosed)
}

try {
  console.log('=== Heres token_interface live check (classic SPL + Token-2022) ===')
  console.log('program:', PROGRAM_ID.toBase58())
  console.log('owner  :', owner.publicKey.toBase58())

  // Fund the throwaway owner from id.json (devnet airdrops are unreliable).
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const fundTx = new anchor.web3.Transaction({ feePayer: funder.publicKey, blockhash, lastValidBlockHeight })
  fundTx.add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: owner.publicKey, lamports: 0.3 * LAMPORTS_PER_SOL }))
  await anchor.web3.sendAndConfirmTransaction(connection, fundTx, [funder], { commitment: 'confirmed' })
  console.log('funded owner 0.3 SOL\n')

  // create the capsule (Switch + BeneficiarySet + Vault) on base. target_date = null.
  await program.methods
    .createCapsule(new BN(86400), funder.publicKey, null)
    .accountsPartial({
      capsule, beneficiarySet: benSet, vault, owner: owner.publicKey, feeConfig,
      platformFeeRecipient: PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .rpc()
  check('created capsule (base)', true)

  await proveTokenProgram('classic SPL', TOKEN_PROGRAM_ID)
  await proveTokenProgram('Token-2022', TOKEN_2022_PROGRAM_ID)
} catch (e) {
  console.error('\nFATAL:', e.message)
  if (e.logs) e.logs.slice(-12).forEach((l) => console.error('   ', l))
  results.push({ name: 'unexpected exception', ok: false })
}

const passed = results.filter((r) => r.ok).length
console.log(`\n=== ${passed}/${results.length} checks passed ===`)
process.exit(results.every((r) => r.ok) ? 0 : 1)

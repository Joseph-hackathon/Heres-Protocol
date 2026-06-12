/**
 * Offline build-check for the LEAN crank (lib/crank.ts) instruction builders + decoder.
 *
 * The crank is server-only TS (path aliases, 'server-only'), so this mirrors its exact Anchor
 * builder calls against the same fresh-build IDL and asserts the account layouts match the lean
 * program - catching the account-order / permission-seed / None-sentinel bugs the rewrite fixed,
 * without needing a live fire or the 48h distribute grace (those stay covered by er-roundtrip +
 * bankrun). Also round-trips the BorshAccountsCoder decode the crank uses for base-layer state.
 *
 * Run: node scripts/magicblock/crank-build-check.mjs
 */
import { PublicKey, SystemProgram, Keypair, Connection } from '@solana/web3.js'
import anchor from '@coral-xyz/anchor'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const { Program, AnchorProvider, BorshAccountsCoder, Wallet, BN } = anchor

const REPO = join(homedir(), 'projects/heres-protocol')
const idl = JSON.parse(readFileSync(join(REPO, 'idl/heres_program.json'), 'utf-8'))
const PROGRAM_ID = new PublicKey(idl.address)

const PERMISSION_PROGRAM_ID = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1')
const MAGIC_CONTEXT_ID = new PublicKey('MagicContext1111111111111111111111111111111')
const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111')
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOC = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

// dummy provider; we only build instructions, never send.
const provider = new AnchorProvider(new Connection('https://api.devnet.solana.com'), new Wallet(Keypair.generate()), {})
const program = new Program(idl, provider)
const coder = new BorshAccountsCoder(idl)

const seed = (s) => Buffer.from(s)
const owner = Keypair.generate().publicKey
const crank = Keypair.generate().publicKey
const ben1 = Keypair.generate().publicKey
const ben2 = Keypair.generate().publicKey

const [capsule] = PublicKey.findProgramAddressSync([seed('intent_capsule'), owner.toBuffer()], PROGRAM_ID)
const [vault] = PublicKey.findProgramAddressSync([seed('capsule_vault'), owner.toBuffer()], PROGRAM_ID)
const [permission] = PublicKey.findProgramAddressSync([seed('permission:'), capsule.toBuffer()], PERMISSION_PROGRAM_ID)
const ata = (mint, o) => PublicKey.findProgramAddressSync([o.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOC)[0]

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`)
}
const keysEq = (keys, expected) =>
  keys.length === expected.length && expected.every((pk, i) => keys[i].pubkey.equals(pk))

console.log('=== lean crank build-check ===')
console.log('program:', PROGRAM_ID.toBase58(), '\n')

// ---- 1. execute_intent: [capsule, permission_program, permission] (NO vault) ----
{
  const ix = await program.methods
    .executeIntent()
    .accountsPartial({ capsule, permissionProgram: PERMISSION_PROGRAM_ID, permission })
    .instruction()
  check('execute_intent: exactly [capsule, permission_program, permission]', keysEq(ix.keys, [capsule, PERMISSION_PROGRAM_ID, permission]),
    `n=${ix.keys.length}`)
  check('execute_intent: capsule is writable', ix.keys[0].isWritable)
  check('execute_intent: permission uses colon seed "permission:"', ix.keys[2].pubkey.equals(permission))
}

// ---- 2. crank_undelegate: [payer, owner, capsule, permission, permission_program, magic_context, magic_program] ----
{
  const ix = await program.methods
    .crankUndelegate()
    .accountsPartial({
      payer: crank, owner, capsule, permission,
      permissionProgram: PERMISSION_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID, magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction()
  check('crank_undelegate: 7 accounts in lean order',
    keysEq(ix.keys, [crank, owner, capsule, permission, PERMISSION_PROGRAM_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID]),
    `n=${ix.keys.length}`)
  check('crank_undelegate: payer signer+writable', ix.keys[0].isSigner && ix.keys[0].isWritable)
  check('crank_undelegate: owner NOT a signer', !ix.keys[1].isSigner)
  check('crank_undelegate: NO vault account present', !ix.keys.some((k) => k.pubkey.equals(vault)))
}

// ---- 3. distribute_assets SOL leg: capsule, vault, system, <None x3>, then beneficiary pubkeys ----
{
  const remaining = [ben1, ben2].map((pk) => ({ pubkey: pk, isSigner: false, isWritable: true }))
  const ix = await program.methods
    .distributeAssets()
    .accountsPartial({ capsule, vault, systemProgram: SystemProgram.programId, tokenProgram: null, mint: null, vaultTokenAccount: null })
    .remainingAccounts(remaining)
    .instruction()
  check('distribute SOL: account[0]=capsule, [1]=vault(writable), [2]=system',
    ix.keys[0].pubkey.equals(capsule) && ix.keys[1].pubkey.equals(vault) && ix.keys[1].isWritable && ix.keys[2].pubkey.equals(SystemProgram.programId))
  // Anchor encodes null optionals as the program-id None sentinel (positions 3,4,5).
  const sentinels = ix.keys.slice(3, 6).every((k) => k.pubkey.equals(PROGRAM_ID))
  check('distribute SOL: 3 optional accounts encoded as program-id None sentinel', sentinels,
    `slots3-5=${ix.keys.slice(3, 6).map((k) => k.pubkey.toBase58().slice(0, 4)).join(',')}`)
  const tail = ix.keys.slice(-2)
  check('distribute SOL: beneficiaries appended as writable remaining accounts',
    tail[0].pubkey.equals(ben1) && tail[1].pubkey.equals(ben2) && tail.every((k) => k.isWritable), `n=${ix.keys.length}`)
}

// ---- 4. distribute_assets SPL leg: real token_program/mint/vault_ata, beneficiary ATAs as remaining ----
{
  const mint = Keypair.generate().publicKey
  const vaultAta = ata(mint, vault)
  const remaining = [ben1, ben2].map((pk) => ({ pubkey: ata(mint, pk), isSigner: false, isWritable: true }))
  const ix = await program.methods
    .distributeAssets()
    .accountsPartial({ capsule, vault, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, mint, vaultTokenAccount: vaultAta })
    .remainingAccounts(remaining)
    .instruction()
  check('distribute SPL: token_program, mint, vault_ata bound (no sentinels)',
    ix.keys.some((k) => k.pubkey.equals(TOKEN_PROGRAM_ID)) && ix.keys.some((k) => k.pubkey.equals(mint)) && ix.keys.some((k) => k.pubkey.equals(vaultAta)))
  check('distribute SPL: beneficiary ATAs appended as remaining',
    ix.keys.some((k) => k.pubkey.equals(ata(mint, ben1))) && ix.keys.some((k) => k.pubkey.equals(ata(mint, ben2))))
}

// ---- 5. decoder round-trip: encode a lean IntentCapsule, decode with the crank's coder, assert fields ----
{
  const sample = {
    owner,
    inactivity_period: new BN(86400),
    last_activity: new BN(1750000000),
    is_active: false,
    executed_at: new BN(1750000123),
    bump: 254,
    vault_bump: 253,
    heartbeat_authority: crank,
    beneficiaries: [
      { pubkey: ben1, share_bps: 6000 },
      { pubkey: ben2, share_bps: 4000 },
    ],
  }
  const buf = await coder.encode('IntentCapsule', sample)
  const d = coder.decode('IntentCapsule', buf)
  const ok =
    d.owner.equals(owner) &&
    d.inactivity_period.toNumber() === 86400 &&
    d.last_activity.toNumber() === 1750000000 &&
    d.is_active === false &&
    d.executed_at.toNumber() === 1750000123 &&
    d.vault_bump === 253 &&
    d.beneficiaries.length === 2 &&
    d.beneficiaries[0].pubkey.equals(ben1) && d.beneficiaries[0].share_bps === 6000 &&
    d.beneficiaries[1].pubkey.equals(ben2) && d.beneficiaries[1].share_bps === 4000
  check('decoder: lean IntentCapsule round-trips (incl beneficiaries Vec + share_bps)', ok,
    `executed_at=${d.executed_at?.toNumber()} bens=${d.beneficiaries.length}`)
  // also: executed_at = None decodes to null (active capsule)
  const buf2 = await coder.encode('IntentCapsule', { ...sample, is_active: true, executed_at: null })
  const d2 = coder.decode('IntentCapsule', buf2)
  check('decoder: executed_at None -> null', d2.executed_at == null)
}

const passed = results.filter((r) => r.ok).length
console.log(`\n=== ${passed}/${results.length} checks passed ===`)
process.exit(results.every((r) => r.ok) ? 0 : 1)

/**
 * Offline build-check for the LEAN crank (lib/crank.ts) instruction builders + decoders.
 *
 * The crank is server-only TS (path aliases, 'server-only'), so this mirrors its exact Anchor
 * builder calls against the same fresh-build IDL and asserts the account layouts match the lean
 * program (Workstream A: Switch on a regular ER, BeneficiarySet on the TEE). Catches account-order /
 * permission-seed / None-sentinel bugs without a live fire or asset distribution (those stay
 * covered by er-roundtrip + bankrun). Also round-trips the BorshAccountsCoder decodes the crank uses.
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
const [benSet] = PublicKey.findProgramAddressSync([seed('beneficiary_set'), owner.toBuffer()], PROGRAM_ID)
const [vault] = PublicKey.findProgramAddressSync([seed('capsule_vault'), owner.toBuffer()], PROGRAM_ID)
// Workstream A: the PER permission is derived from the BeneficiarySet (the only TEE-delegated account).
const [permission] = PublicKey.findProgramAddressSync([seed('permission:'), benSet.toBuffer()], PERMISSION_PROGRAM_ID)
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

// ---- 1. execute_intent: exactly [capsule] (no PER permission; Switch is on a regular ER) ----
{
  const ix = await program.methods.executeIntent().accountsPartial({ capsule }).instruction()
  check('execute_intent: exactly [capsule]', keysEq(ix.keys, [capsule]), `n=${ix.keys.length}`)
  check('execute_intent: capsule is writable', ix.keys[0]?.isWritable)
}

// ---- 2. crank_undelegate (Switch): [payer, owner, capsule, magic_context, magic_program] ----
{
  const ix = await program.methods
    .crankUndelegate()
    .accountsPartial({ payer: crank, owner, capsule, magicContext: MAGIC_CONTEXT_ID, magicProgram: MAGIC_PROGRAM_ID })
    .instruction()
  check('crank_undelegate: 5 accounts in lean order',
    keysEq(ix.keys, [crank, owner, capsule, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID]), `n=${ix.keys.length}`)
  check('crank_undelegate: payer signer+writable', ix.keys[0].isSigner && ix.keys[0].isWritable)
  check('crank_undelegate: owner NOT a signer', !ix.keys[1].isSigner)
  check('crank_undelegate: NO permission/vault accounts present',
    !ix.keys.some((k) => k.pubkey.equals(permission)) && !ix.keys.some((k) => k.pubkey.equals(vault)))
}

// ---- 3. crank_undelegate_beneficiaries (BeneficiarySet reveal): 8 accounts in lean order ----
{
  const ix = await program.methods
    .crankUndelegateBeneficiaries()
    .accountsPartial({
      payer: crank, owner, beneficiarySet: benSet, switch: capsule, permission,
      permissionProgram: PERMISSION_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID, magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction()
  check('crank_undelegate_beneficiaries: 8 accounts in lean order',
    keysEq(ix.keys, [crank, owner, benSet, capsule, permission, PERMISSION_PROGRAM_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID]),
    `n=${ix.keys.length}`)
  check('crank_undelegate_beneficiaries: payer signer+writable', ix.keys[0].isSigner && ix.keys[0].isWritable)
  check('crank_undelegate_beneficiaries: owner NOT a signer', !ix.keys[1].isSigner)
  check('crank_undelegate_beneficiaries: switch (read-only fired-gate) is account[3]', ix.keys[3].pubkey.equals(capsule))
  check('crank_undelegate_beneficiaries: permission derives from beneficiary_set (colon seed)', ix.keys[4].pubkey.equals(permission))
}

// ---- 4. distribute_assets SOL leg: [capsule, beneficiary_set, vault, system, <None x3>, ...bens] ----
{
  const remaining = [ben1, ben2].map((pk) => ({ pubkey: pk, isSigner: false, isWritable: true }))
  const ix = await program.methods
    .distributeAssets()
    .accountsPartial({
      capsule, beneficiarySet: benSet, vault, systemProgram: SystemProgram.programId,
      tokenProgram: null, mint: null, vaultTokenAccount: null,
    })
    .remainingAccounts(remaining)
    .instruction()
  check('distribute SOL: [0]=capsule, [1]=beneficiary_set, [2]=vault(writable), [3]=system',
    ix.keys[0].pubkey.equals(capsule) && ix.keys[1].pubkey.equals(benSet) &&
    ix.keys[2].pubkey.equals(vault) && ix.keys[2].isWritable && ix.keys[3].pubkey.equals(SystemProgram.programId))
  // Anchor encodes null optionals as the program-id None sentinel (positions 4,5,6).
  const sentinels = ix.keys.slice(4, 7).every((k) => k.pubkey.equals(PROGRAM_ID))
  check('distribute SOL: 3 optional accounts encoded as program-id None sentinel', sentinels,
    `slots4-6=${ix.keys.slice(4, 7).map((k) => k.pubkey.toBase58().slice(0, 4)).join(',')}`)
  const tail = ix.keys.slice(-2)
  check('distribute SOL: beneficiaries appended as writable remaining accounts',
    tail[0].pubkey.equals(ben1) && tail[1].pubkey.equals(ben2) && tail.every((k) => k.isWritable), `n=${ix.keys.length}`)
}

// ---- 5. distribute_assets SPL leg: real token_program/mint/vault_ata + beneficiary ATAs as remaining ----
{
  const mint = Keypair.generate().publicKey
  const vaultAta = ata(mint, vault)
  const remaining = [ben1, ben2].map((pk) => ({ pubkey: ata(mint, pk), isSigner: false, isWritable: true }))
  const ix = await program.methods
    .distributeAssets()
    .accountsPartial({ capsule, beneficiarySet: benSet, vault, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, mint, vaultTokenAccount: vaultAta })
    .remainingAccounts(remaining)
    .instruction()
  check('distribute SPL: beneficiary_set present + token_program, mint, vault_ata bound (no sentinels)',
    ix.keys.some((k) => k.pubkey.equals(benSet)) && ix.keys.some((k) => k.pubkey.equals(TOKEN_PROGRAM_ID)) &&
    ix.keys.some((k) => k.pubkey.equals(mint)) && ix.keys.some((k) => k.pubkey.equals(vaultAta)))
  check('distribute SPL: beneficiary ATAs appended as remaining',
    ix.keys.some((k) => k.pubkey.equals(ata(mint, ben1))) && ix.keys.some((k) => k.pubkey.equals(ata(mint, ben2))))
}

// ---- 6. decoder round-trips: Switch (liveness only) + BeneficiarySet (the private list) ----
{
  const switchSample = {
    owner,
    inactivity_period: new BN(86400),
    last_activity: new BN(1750000000),
    is_active: false,
    executed_at: new BN(1750000123),
    bump: 254,
    vault_bump: 253,
    beneficiaries_bump: 252,
    heartbeat_authority: crank,
    version: 1,
    target_date: new BN(1750100000),
    reserved: Array(55).fill(0),
  }
  const buf = await coder.encode('IntentCapsule', switchSample)
  const d = coder.decode('IntentCapsule', buf)
  const switchOk =
    d.owner.equals(owner) &&
    d.inactivity_period.toNumber() === 86400 &&
    d.last_activity.toNumber() === 1750000000 &&
    d.is_active === false &&
    d.executed_at.toNumber() === 1750000123 &&
    d.vault_bump === 253 &&
    d.beneficiaries_bump === 252 &&
    d.target_date.toNumber() === 1750100000 &&
    d.beneficiaries === undefined // beneficiaries are NOT on the Switch anymore
  check('decoder: lean Switch round-trips (liveness only, no beneficiaries)', switchOk,
    `executed_at=${d.executed_at?.toNumber()} benBump=${d.beneficiaries_bump}`)
  const buf2 = await coder.encode('IntentCapsule', { ...switchSample, is_active: true, executed_at: null, target_date: null })
  const d2 = coder.decode('IntentCapsule', buf2)
  check('decoder: executed_at None -> null', d2.executed_at == null)
  check('decoder: target_date None -> null (inactivity-only capsule)', d2.target_date == null)

  const setSample = {
    owner,
    bump: 251,
    version: 1,
    beneficiaries: [
      { pubkey: ben1, share_bps: 6000, reserved: Array(14).fill(0) },
      { pubkey: ben2, share_bps: 4000, reserved: Array(14).fill(0) },
    ],
    reserved: Array(64).fill(0),
  }
  const setBuf = await coder.encode('BeneficiarySet', setSample)
  const ds = coder.decode('BeneficiarySet', setBuf)
  const setOk =
    ds.owner.equals(owner) &&
    ds.beneficiaries.length === 2 &&
    ds.beneficiaries[0].pubkey.equals(ben1) && ds.beneficiaries[0].share_bps === 6000 &&
    ds.beneficiaries[1].pubkey.equals(ben2) && ds.beneficiaries[1].share_bps === 4000
  check('decoder: BeneficiarySet round-trips (beneficiaries Vec + share_bps + reserved)', setOk,
    `bens=${ds.beneficiaries.length}`)
}

const passed = results.filter((r) => r.ok).length
console.log(`\n=== ${passed}/${results.length} checks passed ===`)
process.exit(results.every((r) => r.ok) ? 0 : 1)

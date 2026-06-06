/**
 * Test H2 lifecycle instructions on the fresh deploy:
 *   - cancel_capsule  : owner reclaims locked SOL + closes capsule/vault while still active
 *   - recreate_capsule: reset an executed capsule in place with a new intent + re-locked SOL
 *
 * SOL-only paths (no SPL, no ER). recreate reaches the executed state via a base-layer
 * execute_intent after a short inactivity window. Needs CRANK_WALLET_PRIVATE_KEY for funding.
 */
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import anchor from '@coral-xyz/anchor';
const { AnchorProvider, Program, BN } = anchor;
import bs58 from 'bs58';
import { readFileSync } from 'fs';

const idl = JSON.parse(readFileSync('./idl/HeresProgram.json', 'utf-8'));
const PROGRAM_ID = new PublicKey('2fLojZpdmXLeg2ZXRCXVsqiWnbpF2yFH1SVGS77UC8s3');
const PERMISSION_PROGRAM_ID = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOC_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const PLATFORM_FEE_RECIPIENT = new PublicKey('Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb');

if (!process.env.CRANK_WALLET_PRIVATE_KEY) throw new Error('CRANK_WALLET_PRIVATE_KEY env required');
const crankKp = Keypair.fromSecretKey(bs58.decode(process.env.CRANK_WALLET_PRIVATE_KEY));
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

class W {
  constructor(p) { this.payer = p; }
  get publicKey() { return this.payer.publicKey; }
  async signTransaction(tx) { tx.partialSign(this.payer); return tx; }
  async signAllTransactions(txs) { txs.forEach(t => t.partialSign(this.payer)); return txs; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const assert = (c, l) => { if (c) { console.log(`  [PASS] ${l}`); passed++; } else { console.log(`  [FAIL] ${l}`); failed++; } };

function pdas(owner) {
  const [capsule] = PublicKey.findProgramAddressSync([Buffer.from('intent_capsule'), owner.toBuffer()], PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('capsule_vault'), owner.toBuffer()], PROGRAM_ID);
  const [feeConfig] = PublicKey.findProgramAddressSync([Buffer.from('fee_config')], PROGRAM_ID);
  const [permission] = PublicKey.findProgramAddressSync([Buffer.from('permission'), capsule.toBuffer()], PERMISSION_PROGRAM_ID);
  return { capsule, vault, feeConfig, permission };
}
function progFor(kp) {
  idl.address = PROGRAM_ID.toBase58();
  return new Program(idl, new AnchorProvider(conn, new W(kp), { commitment: 'confirmed' }));
}
async function fund(to, sol) {
  await sendAndConfirmTransaction(conn, new Transaction().add(
    SystemProgram.transfer({ fromPubkey: crankKp.publicKey, toPubkey: to, lamports: Math.floor(sol * LAMPORTS_PER_SOL) })
  ), [crankKp]);
}
function intentJson(totalSol) {
  return JSON.stringify({
    intent: 'h2-test', beneficiaries: [{ address: crankKp.publicKey.toBase58(), amount: '100', amountType: 'percentage' }],
    totalAmount: String(totalSol), inactivityDays: 0, delayDays: 0,
  });
}
async function createSol(kp, inactivity, totalSol) {
  const p = pdas(kp.publicKey), prog = progFor(kp);
  await prog.methods.createCapsule(new BN(inactivity), Buffer.from(intentJson(totalSol))).accounts({
    owner: kp.publicKey, capsule: p.capsule, vault: p.vault, feeConfig: p.feeConfig, platformFeeRecipient: PLATFORM_FEE_RECIPIENT,
    systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, mint: PROGRAM_ID, sourceTokenAccount: PROGRAM_ID,
    vaultTokenAccount: PROGRAM_ID, associatedTokenProgram: ASSOC_TOKEN_PROGRAM_ID, permissionProgram: PERMISSION_PROGRAM_ID, permission: p.permission,
  }).signers([kp]).rpc();
  await fund(p.vault, totalSol);
  return { p, prog };
}

async function testCancel() {
  console.log('\n=== Test A: cancel_capsule (active SOL capsule) ===');
  const owner = Keypair.generate();
  await fund(owner.publicKey, 0.1);
  assert(true, 'owner funded');
  const { p, prog } = await createSol(owner, 120, 0.01);
  assert(true, 'capsule created (inactivity 120s) + vault funded 0.01 SOL');

  const before = await conn.getBalance(owner.publicKey);
  await prog.methods.cancelCapsule().accounts({
    capsule: p.capsule, vault: p.vault, owner: owner.publicKey, systemProgram: SystemProgram.programId,
    tokenProgram: null, mint: null, vaultTokenAccount: null, ownerTokenAccount: null,
  }).signers([owner]).rpc();
  assert(true, 'cancel_capsule tx confirmed');

  const capsuleAcc = await conn.getAccountInfo(p.capsule);
  const vaultAcc = await conn.getAccountInfo(p.vault);
  const after = await conn.getBalance(owner.publicKey);
  assert(capsuleAcc === null, 'capsule account closed');
  assert(vaultAcc === null, 'vault account closed');
  assert(after > before, `owner refunded (locked SOL + rent): ${(after - before) / LAMPORTS_PER_SOL} SOL`);
}

async function testRecreate() {
  console.log('\n=== Test B: recreate_capsule (executed -> reset in place) ===');
  const owner = Keypair.generate();
  await fund(owner.publicKey, 0.15);
  assert(true, 'owner funded');
  const { p, prog } = await createSol(owner, 2, 0.01);
  assert(true, 'capsule created (inactivity 2s) + vault funded');

  await sleep(3500);
  await prog.methods.executeIntent().accounts({
    capsule: p.capsule, vault: p.vault, permissionProgram: PERMISSION_PROGRAM_ID, permission: p.permission,
  }).rpc();
  let c = await prog.account.intentCapsule.fetch(p.capsule);
  assert(c.isActive === false && c.executedAt !== null, 'execute_intent (base layer) -> capsule executed');

  await prog.methods.recreateCapsule(new BN(120), Buffer.from(intentJson(0.008))).accounts({
    capsule: p.capsule, vault: p.vault, owner: owner.publicKey, systemProgram: SystemProgram.programId, feeConfig: p.feeConfig,
    tokenProgram: TOKEN_PROGRAM_ID, mint: null, sourceTokenAccount: null, vaultTokenAccount: null,
  }).signers([owner]).rpc();
  c = await prog.account.intentCapsule.fetch(p.capsule);
  assert(c.isActive === true, 'recreate -> is_active reset true');
  assert(c.executedAt === null, 'recreate -> executed_at reset null');
  assert(c.lockedAmount.toString() === String(Math.floor(0.008 * LAMPORTS_PER_SOL)), `recreate -> locked_amount = ${c.lockedAmount.toString()}`);

  // cleanup: cancel the recreated (now active) capsule
  await prog.methods.cancelCapsule().accounts({
    capsule: p.capsule, vault: p.vault, owner: owner.publicKey, systemProgram: SystemProgram.programId,
    tokenProgram: null, mint: null, vaultTokenAccount: null, ownerTokenAccount: null,
  }).signers([owner]).rpc();
  assert((await conn.getAccountInfo(p.capsule)) === null, 'recreated capsule cancelled + closed (cleanup)');
}

(async () => {
  console.log('=== H2 cancel_capsule / recreate_capsule test (devnet, program 2fLojZ...) ===');
  try { await testCancel(); } catch (e) { console.log('  [FAIL] testCancel threw:', e.message); failed++; }
  try { await testRecreate(); } catch (e) { console.log('  [FAIL] testRecreate threw:', e.message); failed++; }
  console.log(`\n===== ${passed} passed, ${failed} failed =====`);
  process.exit(failed === 0 ? 0 : 1);
})();

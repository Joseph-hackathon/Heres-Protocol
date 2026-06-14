/**
 * HISTORICAL (provenance): this probe targets the OLD program 2fLojZ + the OLD account model
 * (create with dummy mint/token accounts, delegate of BOTH capsule and vault). It answered the
 * ScheduleTask cost question (Q3 = FREE) on 2026-06-11 and is kept as the evidence trail. For the
 * current lean program (sDRdG2qt, Switch-only delegation) use er-roundtrip.mjs in this folder.
 *
 * Measure MagicBlock ScheduleTask cost (answers open Q3).
 *
 * Flow: create -> fund vault -> delegate to Asia ER -> schedule_execute_intent
 *       (interval 5s, 12 iterations) -> watch balances across every tick -> undelegate.
 *
 * Key difference vs test-er-delegation.mjs: inactivity_period = 3600s, so execute_intent
 * REVERTS (InactivityPeriodNotMet) on every tick instead of firing once. That keeps the
 * scheduled task ticking against a no-op, isolating the pure per-execution cost:
 *   - schedule-registration cost  = owner-ER balance delta across the schedule tx
 *   - per-tick cost               = monotonic balance decay (owner/vault, base+ER) across ticks
 *   - escrow/deposit              = any account whose balance INCREASES in the schedule tx
 *   - who pays long-term          = whichever balance (if any) decays per tick
 *
 * Run: node --env-file=.env scripts/measure-scheduletask-cost.mjs
 */
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import anchor from '@coral-xyz/anchor';
const { BorshAccountsCoder } = anchor;
import bs58 from 'bs58';
import { readFileSync } from 'fs';

const idl = JSON.parse(readFileSync('./idl/heres_program.json', 'utf-8'));
const PROGRAM_ID = new PublicKey('2fLojZpdmXLeg2ZXRCXVsqiWnbpF2yFH1SVGS77UC8s3');
const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT_ID = new PublicKey('MagicContext1111111111111111111111111111111');
const PERMISSION_PROGRAM_ID = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');
const ACTIVE_VALIDATOR = new PublicKey('MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOC_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const PLATFORM_FEE_RECIPIENT = new PublicKey('Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb');

// Discriminators (deployed binary, from idl/heres_program.json)
const DISC_CREATE = Buffer.from([195, 104, 42, 180, 127, 169, 62, 3]);
const DISC_DELEGATE = Buffer.from([127, 232, 253, 109, 16, 100, 1, 7]);
const DISC_SCHEDULE = Buffer.from([88, 30, 30, 42, 9, 75, 31, 189]);
const DISC_CRANK_UNDELEGATE = idl.instructions.find(i => i.name === 'crank_undelegate')?.discriminator;

// Test knobs (env-overridable for the "fires" variant)
const INACTIVITY_PERIOD = Number(process.env.PROBE_INACTIVITY ?? 3600);   // 3600 -> reverts every tick; 0 -> fires on first tick
const INTERVAL_MS = Number(process.env.PROBE_INTERVAL_MS ?? 5000);        // tick cadence
const ITERATIONS = Number(process.env.PROBE_ITERATIONS ?? 12);            // tick count
const WATCH_SECONDS = Number(process.env.PROBE_WATCH_SECONDS ?? 80);      // poll window
const POLL_EVERY_MS = Number(process.env.PROBE_POLL_MS ?? 4000);

if (!process.env.CRANK_WALLET_PRIVATE_KEY) throw new Error('CRANK_WALLET_PRIVATE_KEY env required');
const crankKp = Keypair.fromSecretKey(bs58.decode(process.env.CRANK_WALLET_PRIVATE_KEY));
const ownerKp = Keypair.generate();

const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const erConn = new Connection('https://devnet-as.magicblock.app', 'confirmed');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// PDAs
const [capsulePDA] = PublicKey.findProgramAddressSync([Buffer.from('intent_capsule'), ownerKp.publicKey.toBuffer()], PROGRAM_ID);
const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('capsule_vault'), ownerKp.publicKey.toBuffer()], PROGRAM_ID);
const [feeConfigPDA] = PublicKey.findProgramAddressSync([Buffer.from('fee_config')], PROGRAM_ID);
const [permissionPDA] = PublicKey.findProgramAddressSync([Buffer.from('permission'), capsulePDA.toBuffer()], PERMISSION_PROGRAM_ID);
const [bufferPDA] = PublicKey.findProgramAddressSync([Buffer.from('buffer'), capsulePDA.toBuffer()], PROGRAM_ID);
const [delegationRecordPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation'), capsulePDA.toBuffer()], DELEGATION_PROGRAM_ID);
const [delegationMetadataPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation-metadata'), capsulePDA.toBuffer()], DELEGATION_PROGRAM_ID);
const [bufferVaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('buffer'), vaultPDA.toBuffer()], PROGRAM_ID);
const [delegationRecordVaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation'), vaultPDA.toBuffer()], DELEGATION_PROGRAM_ID);
const [delegationMetadataVaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation-metadata'), vaultPDA.toBuffer()], DELEGATION_PROGRAM_ID);

const SOL = n => (n / LAMPORTS_PER_SOL);
const fmt = n => (n / LAMPORTS_PER_SOL).toFixed(9);

async function snapshot(label) {
  const [obB, vbB, obE, vbE] = await Promise.all([
    conn.getBalance(ownerKp.publicKey).catch(() => null),
    conn.getBalance(vaultPDA).catch(() => null),
    erConn.getBalance(ownerKp.publicKey).catch(() => null),
    erConn.getBalance(vaultPDA).catch(() => null),
  ]);
  return { label, t: label, ownerBase: obB, vaultBase: vbB, ownerER: obE, vaultER: vbE };
}

console.log('=== MagicBlock ScheduleTask cost probe (Asia devnet) ===\n');
console.log('Owner:     ', ownerKp.publicKey.toBase58());
console.log('Capsule:   ', capsulePDA.toBase58());
console.log('Vault:     ', vaultPDA.toBase58());
console.log('Permission:', permissionPDA.toBase58());
console.log(`Knobs: inactivity=${INACTIVITY_PERIOD}s interval=${INTERVAL_MS}ms iterations=${ITERATIONS}\n`);

// ---- Step 1: fund owner ----
await sendAndConfirmTransaction(conn, new Transaction().add(
  SystemProgram.transfer({ fromPubkey: crankKp.publicKey, toPubkey: ownerKp.publicKey, lamports: Math.floor(0.1 * LAMPORTS_PER_SOL) })
), [crankKp]);
console.log('Step 1: owner funded 0.1 SOL');

// ---- Step 2: create capsule (manual ix, deployed account order) ----
const intent = JSON.stringify({
  intent: 'scheduletask-cost-probe',
  beneficiaries: [{ address: crankKp.publicKey.toBase58(), amount: '100', amountType: 'percentage' }],
  totalAmount: '0.003', inactivityDays: 0, delayDays: 0,
});
const intentBuf = Buffer.from(intent);
const periodBuf = Buffer.alloc(8); periodBuf.writeBigInt64LE(BigInt(INACTIVITY_PERIOD));
const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32LE(intentBuf.length);
const createData = Buffer.concat([DISC_CREATE, periodBuf, lenBuf, intentBuf]);
const createIx = new TransactionInstruction({
  programId: PROGRAM_ID, data: createData,
  keys: [
    { pubkey: capsulePDA, isSigner: false, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: ownerKp.publicKey, isSigner: true, isWritable: true },
    { pubkey: feeConfigPDA, isSigner: false, isWritable: false },
    { pubkey: PLATFORM_FEE_RECIPIENT, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },         // mint (dummy, SOL-only)
    { pubkey: PROGRAM_ID, isSigner: false, isWritable: true },          // source_token_account (dummy)
    { pubkey: PROGRAM_ID, isSigner: false, isWritable: true },          // vault_token_account (dummy)
    { pubkey: ASSOC_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ],
});
await sendAndConfirmTransaction(conn, new Transaction().add(createIx), [ownerKp]);
console.log('Step 2: capsule created (inactivity_period=' + INACTIVITY_PERIOD + 's)');

// ---- Step 3: fund vault ----
await sendAndConfirmTransaction(conn, new Transaction().add(
  SystemProgram.transfer({ fromPubkey: ownerKp.publicKey, toPubkey: vaultPDA, lamports: Math.floor(0.003 * LAMPORTS_PER_SOL) })
), [ownerKp]);
console.log('Step 3: vault funded 0.003 SOL');

// ---- Step 4: delegate (manual ix, deployed 15-account order) ----
const delegateIx = new TransactionInstruction({
  programId: PROGRAM_ID, data: DISC_DELEGATE,
  keys: [
    { pubkey: ownerKp.publicKey, isSigner: true, isWritable: true },      // payer
    { pubkey: ownerKp.publicKey, isSigner: true, isWritable: false },     // owner
    { pubkey: ACTIVE_VALIDATOR, isSigner: false, isWritable: false },     // validator
    { pubkey: bufferPDA, isSigner: false, isWritable: true },
    { pubkey: delegationRecordPDA, isSigner: false, isWritable: true },
    { pubkey: delegationMetadataPDA, isSigner: false, isWritable: true },
    { pubkey: capsulePDA, isSigner: false, isWritable: true },            // pda
    { pubkey: bufferVaultPDA, isSigner: false, isWritable: true },
    { pubkey: delegationRecordVaultPDA, isSigner: false, isWritable: true },
    { pubkey: delegationMetadataVaultPDA, isSigner: false, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },              // vault
    { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },           // owner_program
  ],
});
await sendAndConfirmTransaction(conn, new Transaction().add(delegateIx), [ownerKp]);
await sleep(3000);
const di = await conn.getAccountInfo(capsulePDA);
console.log('Step 4: delegated. capsule owner =', di?.owner.toBase58(), di?.owner.equals(DELEGATION_PROGRAM_ID) ? '(Delegation Program OK)' : '(UNEXPECTED)');

// ---- Step 5: snapshot BEFORE scheduling ----
const s0 = await snapshot('S0 pre-schedule');
console.log('\nStep 5: pre-schedule snapshot');
console.log(`  ownerBase=${fmt(s0.ownerBase)} vaultBase=${fmt(s0.vaultBase)} ownerER=${fmt(s0.ownerER)} vaultER=${fmt(s0.vaultER)}`);

// ---- Step 6: schedule_execute_intent on ER (6 accounts per deployed IDL) ----
const argsBuf = Buffer.alloc(24);
argsBuf.writeBigUInt64LE(BigInt(Date.now()), 0);         // task_id
argsBuf.writeBigUInt64LE(BigInt(INTERVAL_MS), 8);        // execution_interval_millis
argsBuf.writeBigUInt64LE(BigInt(ITERATIONS), 16);        // iterations
const scheduleIx = new TransactionInstruction({
  programId: PROGRAM_ID, data: Buffer.concat([DISC_SCHEDULE, argsBuf]),
  keys: [
    { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ownerKp.publicKey, isSigner: true, isWritable: true },   // payer
    { pubkey: capsulePDA, isSigner: false, isWritable: true },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: PERMISSION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: permissionPDA, isSigner: false, isWritable: false },
  ],
});
const { blockhash, lastValidBlockHeight } = await erConn.getLatestBlockhash('confirmed');
const schedTx = new Transaction({ feePayer: ownerKp.publicKey, blockhash, lastValidBlockHeight }).add(scheduleIx);
schedTx.sign(ownerKp);
const schedSig = await erConn.sendRawTransaction(schedTx.serialize(), { skipPreflight: true });
await erConn.confirmTransaction({ signature: schedSig, blockhash, lastValidBlockHeight }, 'confirmed');
console.log('\nStep 6: scheduled. sig =', schedSig);

// Inspect the schedule tx: fee + per-account balance deltas (find escrow/deposit)
await sleep(2000);
const schedInfo = await erConn.getTransaction(schedSig, { maxSupportedTransactionVersion: 0 });
if (schedInfo?.meta) {
  console.log('  ER tx fee:', schedInfo.meta.fee, 'lamports');
  if (schedInfo.meta.err) console.log('  ER tx ERR:', JSON.stringify(schedInfo.meta.err));
  const keys = schedInfo.transaction.message.staticAccountKeys ?? schedInfo.transaction.message.accountKeys;
  const pre = schedInfo.meta.preBalances, post = schedInfo.meta.postBalances;
  console.log('  per-account lamport deltas in schedule tx:');
  for (let i = 0; i < keys.length; i++) {
    const d = post[i] - pre[i];
    if (d !== 0) console.log(`    ${keys[i].toBase58()}  ${d > 0 ? '+' : ''}${d}`);
  }
  (schedInfo.meta.logMessages || []).filter(l => /task|schedul|interval|iteration/i.test(l)).slice(0, 8).forEach(l => console.log('   log:', l));
}

// ---- Step 7: watch balances across every tick ----
console.log(`\nStep 7: watching ${WATCH_SECONDS}s (tick=${INTERVAL_MS}ms x ${ITERATIONS})`);
const series = [];
const startedAt = Date.now();
let last = await snapshot('S1 post-schedule');
series.push(last);
console.log(`  t+0s    ownerER=${fmt(last.ownerER)} vaultER=${fmt(last.vaultER)} ownerBase=${fmt(last.ownerBase)} vaultBase=${fmt(last.vaultBase)}`);
while (Date.now() - startedAt < WATCH_SECONDS * 1000) {
  await sleep(POLL_EVERY_MS);
  const s = await snapshot('poll');
  const dOE = s.ownerER - last.ownerER, dVE = s.vaultER - last.vaultER, dOB = s.ownerBase - last.ownerBase, dVB = s.vaultBase - last.vaultBase;
  const secs = Math.round((Date.now() - startedAt) / 1000);
  const mark = (dOE || dVE || dOB || dVB) ? '  <-- change' : '';
  console.log(`  t+${secs}s  ownerER=${fmt(s.ownerER)}(${dOE}) vaultER=${fmt(s.vaultER)}(${dVE}) ownerBase=${fmt(s.ownerBase)}(${dOB}) vaultBase=${fmt(s.vaultBase)}(${dVB})${mark}`);
  series.push(s); last = s;
}

// ---- Step 8: did execute_intent fire, or revert every tick? ----
console.log('\nStep 8: capsule state on ER (expect is_active=true if every tick reverted)');
try {
  const erCap = await erConn.getAccountInfo(capsulePDA);
  const coder = new BorshAccountsCoder(idl);
  const data = coder.decode('IntentCapsule', erCap.data);
  const isActive = data.is_active ?? data.isActive;
  const executedAt = data.executed_at ?? data.executedAt;
  console.log('  is_active =', isActive, '| executed_at =', executedAt?.toString?.() ?? executedAt);
  console.log('  ->', isActive === true ? 'capsule still active: ticks reverted (InactivityPeriodNotMet). Per-tick cost isolated.' : 'capsule fired: execute_intent succeeded (revisit inactivity assumption).');
} catch (e) {
  console.log('  decode/read error:', e.message?.slice(0, 160));
}

// ---- Step 9: summary ----
const first = series[0], lastS = series[series.length - 1];
console.log('\n=== SUMMARY ===');
console.log(`schedule registration cost (ownerER delta S0->S1): ${(s0.ownerER - first.ownerER)} lamports (${SOL(s0.ownerER - first.ownerER).toFixed(9)} SOL)`);
console.log(`across watch window (S1 -> end):`);
console.log(`  ownerER  ${first.ownerER} -> ${lastS.ownerER}  (delta ${lastS.ownerER - first.ownerER})`);
console.log(`  vaultER  ${first.vaultER} -> ${lastS.vaultER}  (delta ${lastS.vaultER - first.vaultER})`);
console.log(`  ownerBase ${first.ownerBase} -> ${lastS.ownerBase}  (delta ${lastS.ownerBase - first.ownerBase})`);
console.log(`  vaultBase ${first.vaultBase} -> ${lastS.vaultBase}  (delta ${lastS.vaultBase - first.vaultBase})`);
console.log('Interpretation: any per-tick decay above identifies the payer + per-execution cost. Flat = gasless on ER (validator absorbs compute).');

// ---- Step 10: cleanup - crank_undelegate (also captures one-time undelegate cost) ----
console.log('\nStep 10: crank_undelegate (cleanup + one-time undelegate cost)');
try {
  const undData = Buffer.from(DISC_CRANK_UNDELEGATE);
  const undIx = new TransactionInstruction({
    programId: PROGRAM_ID, data: undData,
    keys: [
      { pubkey: ownerKp.publicKey, isSigner: true, isWritable: true },
      { pubkey: capsulePDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
  const bh = await erConn.getLatestBlockhash('confirmed');
  const utx = new Transaction({ feePayer: ownerKp.publicKey, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }).add(undIx);
  utx.sign(ownerKp);
  const usig = await erConn.sendRawTransaction(utx.serialize(), { skipPreflight: true });
  await erConn.confirmTransaction({ signature: usig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
  const uinfo = await erConn.getTransaction(usig, { maxSupportedTransactionVersion: 0 });
  console.log('  undelegate sig:', usig, '| err:', JSON.stringify(uinfo?.meta?.err ?? null), '| ER fee:', uinfo?.meta?.fee);
  let back = false;
  for (let i = 0; i < 10; i++) { await sleep(2500); const info = await conn.getAccountInfo(capsulePDA); if (info?.owner.equals(PROGRAM_ID)) { back = true; break; } }
  console.log('  ownership returned to base:', back);
} catch (e) {
  console.log('  undelegate error (non-fatal, throwaway owner):', e.message?.slice(0, 160));
}

console.log('\nDone.');
process.exit(0);

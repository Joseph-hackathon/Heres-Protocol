/**
 * Test MagicBlock ER Full Flow: Create → Delegate → Schedule Crank → Wait → Check Execution
 */
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import anchor from '@coral-xyz/anchor';
const { AnchorProvider, Program, BN, BorshAccountsCoder } = anchor;
import bs58 from 'bs58';
import { readFileSync } from 'fs';

const idl = JSON.parse(readFileSync('./idl/HeresProgram.json', 'utf-8'));
const PROGRAM_ID = new PublicKey('2fLojZpdmXLeg2ZXRCXVsqiWnbpF2yFH1SVGS77UC8s3');
const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111');
// #[delegate] macro derives buffer PDAs using the program's own ID at runtime
const BUFFER_SEED_PROGRAM_ID = new PublicKey('2fLojZpdmXLeg2ZXRCXVsqiWnbpF2yFH1SVGS77UC8s3');
const MAGIC_CONTEXT_ID = new PublicKey('MagicContext1111111111111111111111111111111');
const PERMISSION_PROGRAM_ID = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');
const ACTIVE_VALIDATOR = new PublicKey('MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOC_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const PLATFORM_FEE_RECIPIENT = new PublicKey('Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb');

if (!process.env.CRANK_WALLET_PRIVATE_KEY) throw new Error('CRANK_WALLET_PRIVATE_KEY env required')
const crankKp = Keypair.fromSecretKey(bs58.decode(process.env.CRANK_WALLET_PRIVATE_KEY));
const ownerKp = Keypair.generate();

const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const erConn = new Connection('https://devnet-as.magicblock.app', 'confirmed');

class W {
  constructor(p) { this.payer = p; }
  get publicKey() { return this.payer.publicKey; }
  async signTransaction(tx) { tx.partialSign(this.payer); return tx; }
  async signAllTransactions(txs) { txs.forEach(t => t.partialSign(this.payer)); return txs; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const [capsulePDA] = PublicKey.findProgramAddressSync([Buffer.from('intent_capsule'), ownerKp.publicKey.toBuffer()], PROGRAM_ID);
const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('capsule_vault'), ownerKp.publicKey.toBuffer()], PROGRAM_ID);
const [feeConfigPDA] = PublicKey.findProgramAddressSync([Buffer.from('fee_config')], PROGRAM_ID);
const [permissionPDA] = PublicKey.findProgramAddressSync([Buffer.from('permission'), capsulePDA.toBuffer()], PERMISSION_PROGRAM_ID);

// Delegation PDAs
const [bufferPDA] = PublicKey.findProgramAddressSync([Buffer.from('buffer'), capsulePDA.toBuffer()], BUFFER_SEED_PROGRAM_ID);
const [delegationRecordPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation'), capsulePDA.toBuffer()], DELEGATION_PROGRAM_ID);
const [delegationMetadataPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation-metadata'), capsulePDA.toBuffer()], DELEGATION_PROGRAM_ID);
const [vaultBufferPDA] = PublicKey.findProgramAddressSync([Buffer.from('buffer'), vaultPDA.toBuffer()], BUFFER_SEED_PROGRAM_ID);
const [vaultDelegationRecordPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation'), vaultPDA.toBuffer()], DELEGATION_PROGRAM_ID);
const [vaultDelegationMetadataPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation-metadata'), vaultPDA.toBuffer()], DELEGATION_PROGRAM_ID);

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`  [PASS] ${label}`); passed++; }
  else { console.log(`  [FAIL] ${label}`); failed++; }
}

console.log('=== MagicBlock ER Full Flow Test (Asia devnet) ===\n');
console.log('Owner:      ', ownerKp.publicKey.toBase58());
console.log('Capsule PDA:', capsulePDA.toBase58());
console.log('Vault PDA:  ', vaultPDA.toBase58());
console.log('Validator:  ', ACTIVE_VALIDATOR.toBase58());
console.log('ER RPC:      https://devnet-as.magicblock.app');

// ========= Step 1: Fund owner =========
console.log('\nStep 1: Fund owner');
await sendAndConfirmTransaction(conn, new Transaction().add(
  SystemProgram.transfer({ fromPubkey: crankKp.publicKey, toPubkey: ownerKp.publicKey, lamports: Math.floor(0.1 * LAMPORTS_PER_SOL) })
), [crankKp]);
assert(true, 'Owner funded');

// ========= Step 2: Create capsule =========
console.log('\nStep 2: Create capsule');
const ownerProv = new AnchorProvider(conn, new W(ownerKp), { commitment: 'confirmed' });
idl.address = PROGRAM_ID.toBase58();
const ownerProg = new Program(idl, ownerProv);
const intent = JSON.stringify({
  intent: 'er-crank-test',
  beneficiaries: [{ address: crankKp.publicKey.toBase58(), amount: '100', amountType: 'percentage' }],
  totalAmount: '0.003', inactivityDays: 0, delayDays: 0,
});
await ownerProg.methods.createCapsule(new BN(5), Buffer.from(intent))
  .accounts({
    owner: ownerKp.publicKey, capsule: capsulePDA, vault: vaultPDA,
    feeConfig: feeConfigPDA, platformFeeRecipient: PLATFORM_FEE_RECIPIENT,
    systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
    mint: PROGRAM_ID, sourceTokenAccount: PROGRAM_ID, vaultTokenAccount: PROGRAM_ID,
    associatedTokenProgram: ASSOC_TOKEN_PROGRAM_ID,
    permissionProgram: PERMISSION_PROGRAM_ID, permission: permissionPDA,
  }).signers([ownerKp]).rpc();
assert(true, 'Capsule created');

// ========= Step 3: Fund vault =========
console.log('\nStep 3: Fund vault');
await sendAndConfirmTransaction(conn, new Transaction().add(
  SystemProgram.transfer({ fromPubkey: ownerKp.publicKey, toPubkey: vaultPDA, lamports: Math.floor(0.003 * LAMPORTS_PER_SOL) })
), [ownerKp]);
assert(true, 'Vault funded');

// ========= Step 4: Delegate to Asia ER =========
console.log('\nStep 4: Delegate to Asia ER');
const delegateTx = await ownerProg.methods.delegateCapsule()
  .accounts({
    payer: ownerKp.publicKey, owner: ownerKp.publicKey, validator: ACTIVE_VALIDATOR,
    pda: capsulePDA, pdaBuffer: bufferPDA, pdaDelegationRecord: delegationRecordPDA,
    pdaDelegationMetadata: delegationMetadataPDA, vault: vaultPDA, vaultBuffer: vaultBufferPDA,
    vaultDelegationRecord: vaultDelegationRecordPDA, vaultDelegationMetadata: vaultDelegationMetadataPDA,
    magicProgram: MAGIC_PROGRAM_ID, delegationProgram: DELEGATION_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([ownerKp]).rpc();
assert(true, `Delegation tx: ${delegateTx.slice(0, 20)}...`);

await sleep(3000);
const postInfo = await conn.getAccountInfo(capsulePDA);
assert(postInfo?.owner.equals(DELEGATION_PROGRAM_ID), 'Capsule owner = Delegation Program');

// ========= Step 5: Verify on ER RPC =========
console.log('\nStep 5: Verify capsule on ER RPC');
const erInfo = await erConn.getAccountInfo(capsulePDA);
assert(erInfo !== null, `Capsule visible on ER RPC (data: ${erInfo?.data?.length || 0} bytes)`);

// ========= Step 6: Schedule crank on ER =========
console.log('\nStep 6: Schedule crank on ER (manual 6-account instruction)');
try {
  // Build manual TransactionInstruction matching deployed binary (6 accounts).
  // The IDL has 12 accounts but the deployed binary's ScheduleExecuteIntent only has 6.
  const discriminator = Buffer.from([88, 30, 30, 42, 9, 75, 31, 189]); // schedule_execute_intent
  const argsBuf = Buffer.alloc(24);
  argsBuf.writeBigUInt64LE(BigInt(Date.now()), 0);
  argsBuf.writeBigUInt64LE(BigInt(10000), 8);  // 10s interval
  argsBuf.writeBigUInt64LE(BigInt(10), 16);     // 10 iterations
  const ixData = Buffer.concat([discriminator, argsBuf]);

  const { TransactionInstruction } = await import('@solana/web3.js');
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ownerKp.publicKey, isSigner: true, isWritable: true },
      { pubkey: capsulePDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: PERMISSION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: permissionPDA, isSigner: false, isWritable: false },
      { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data: ixData,
  });

  const { blockhash, lastValidBlockHeight } = await erConn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: ownerKp.publicKey, blockhash, lastValidBlockHeight });
  tx.add(ix);
  tx.sign(ownerKp);

  const txSig = await erConn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await erConn.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, 'confirmed');
  assert(true, `Crank scheduled: ${txSig.slice(0, 20)}...`);
} catch (err) {
  console.log('  Schedule error:', err.message?.slice(0, 300));
  if (err.logs) err.logs.slice(-5).forEach(l => console.log('   ', l));
  assert(false, 'Crank scheduling failed');
}

// ========= Step 7: Wait for inactivity + crank execution =========
console.log('\nStep 7: Wait 15s for inactivity + crank execution');
await sleep(15000);

const erCapsule = await erConn.getAccountInfo(capsulePDA);
if (erCapsule) {
  try {
    const coder = new BorshAccountsCoder(idl);
    const data = coder.decode('IntentCapsule', erCapsule.data);
    const isActive = data.is_active ?? data.isActive;
    const executedAt = data.executed_at ?? data.executedAt;
    console.log(`  is_active: ${isActive} | executed_at: ${executedAt?.toString()}`);
    if (isActive === false || (executedAt && executedAt.toNumber() > 0)) {
      assert(true, 'Capsule executed by ER crank!');
    } else {
      assert(false, 'Capsule still active (crank may need more time)');
      console.log('  NOTE: Crank scheduled but may need longer interval. The scheduling itself worked.');
    }
  } catch (e) {
    console.log('  Decode error:', e.message?.slice(0, 100));
    assert(false, 'Failed to decode capsule state');
  }
} else {
  assert(false, 'Capsule not found on ER');
}

// ========= Summary =========
console.log('\n========================================');
console.log(`ER Test Results: ${passed} passed, ${failed} failed`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);

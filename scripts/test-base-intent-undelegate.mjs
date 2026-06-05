/**
 * Test: execute_intent on ER → ScheduleBaseIntent(CommitAndUndelegate) → verify base layer return
 */
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import anchor from '@coral-xyz/anchor';
const { AnchorProvider, Program, BN, BorshAccountsCoder } = anchor;
import bs58 from 'bs58';
import { readFileSync } from 'fs';
import { serialize } from 'borsh';

const idl = JSON.parse(readFileSync('./idl/HeresProgram.json', 'utf-8'));
const PROGRAM_ID = new PublicKey('AmiL7vEZ2SpAuDXzdxC3sJMyjZqgacvwvvQdT3qosmsW');
const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111');
// #[delegate] macro derives buffer PDAs using the program's own ID at runtime
const BUFFER_SEED_PROGRAM_ID = new PublicKey('AmiL7vEZ2SpAuDXzdxC3sJMyjZqgacvwvvQdT3qosmsW');
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
const [vaultDelegRecPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation'), vaultPDA.toBuffer()], DELEGATION_PROGRAM_ID);
const [vaultDelegMetaPDA] = PublicKey.findProgramAddressSync([Buffer.from('delegation-metadata'), vaultPDA.toBuffer()], DELEGATION_PROGRAM_ID);

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`  [PASS] ${label}`); passed++; }
  else { console.log(`  [FAIL] ${label}`); failed++; }
}

console.log('=== Execute + ScheduleBaseIntent(CommitAndUndelegate) Test ===\n');
console.log('Owner:', ownerKp.publicKey.toBase58());
console.log('Capsule:', capsulePDA.toBase58());
console.log('Vault:', vaultPDA.toBase58());

// Step 1: Fund
console.log('\nStep 1: Fund owner');
await sendAndConfirmTransaction(conn, new Transaction().add(
  SystemProgram.transfer({ fromPubkey: crankKp.publicKey, toPubkey: ownerKp.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })
), [crankKp]);
assert(true, 'Owner funded');

// Step 2: Create capsule (0s inactivity)
console.log('\nStep 2: Create capsule');
const ownerProv = new AnchorProvider(conn, new W(ownerKp), { commitment: 'confirmed' });
idl.address = PROGRAM_ID.toBase58();
const ownerProg = new Program(idl, ownerProv);
const intent = JSON.stringify({
  intent: 'undelegate-test-v2',
  beneficiaries: [{ address: crankKp.publicKey.toBase58(), amount: '100', amountType: 'percentage' }],
  totalAmount: '0.003', inactivityDays: 0, delayDays: 0,
});
await ownerProg.methods.createCapsule(new BN(0), Buffer.from(intent))
  .accounts({
    owner: ownerKp.publicKey, capsule: capsulePDA, vault: vaultPDA,
    feeConfig: feeConfigPDA, platformFeeRecipient: PLATFORM_FEE_RECIPIENT,
    systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
    mint: PROGRAM_ID, sourceTokenAccount: PROGRAM_ID, vaultTokenAccount: PROGRAM_ID,
    associatedTokenProgram: ASSOC_TOKEN_PROGRAM_ID,
    permissionProgram: PERMISSION_PROGRAM_ID, permission: permissionPDA,
  }).signers([ownerKp]).rpc();
assert(true, 'Capsule created');

// Step 3: Fund vault
console.log('\nStep 3: Fund vault');
await sendAndConfirmTransaction(conn, new Transaction().add(
  SystemProgram.transfer({ fromPubkey: ownerKp.publicKey, toPubkey: vaultPDA, lamports: Math.floor(0.003 * LAMPORTS_PER_SOL) })
), [ownerKp]);
assert(true, 'Vault funded');

// Step 4: Delegate
console.log('\nStep 4: Delegate to ER');
await ownerProg.methods.delegateCapsule()
  .accounts({
    payer: ownerKp.publicKey, owner: ownerKp.publicKey, validator: ACTIVE_VALIDATOR,
    pda: capsulePDA, pdaBuffer: bufferPDA, pdaDelegationRecord: delegationRecordPDA,
    pdaDelegationMetadata: delegationMetadataPDA, vault: vaultPDA, vaultBuffer: vaultBufferPDA,
    vaultDelegationRecord: vaultDelegRecPDA, vaultDelegationMetadata: vaultDelegMetaPDA,
    magicProgram: MAGIC_PROGRAM_ID, delegationProgram: DELEGATION_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([ownerKp]).rpc();
assert(true, 'Delegated');
await sleep(3000);

// Step 5: Execute on ER (state change only, no commit_and_undelegate)
console.log('\nStep 5: Execute intent on ER');
try {
  // Deployed binary has 7 accounts (4 required + 3 optional for commit_and_undelegate)
  // Pass PROGRAM_ID as sentinel for optional accounts to skip commit_and_undelegate
  const disc = Buffer.from([53, 130, 47, 154, 227, 220, 122, 212]); // execute_intent
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: capsulePDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: PERMISSION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: permissionPDA, isSigner: false, isWritable: false },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },  // payer sentinel
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },  // magic_context sentinel
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },  // magic_program sentinel
    ],
    programId: PROGRAM_ID,
    data: disc,
  });
  const { blockhash, lastValidBlockHeight } = await erConn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: ownerKp.publicKey, blockhash, lastValidBlockHeight });
  tx.add(ix);
  tx.sign(ownerKp);
  const sig = await erConn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await erConn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

  // Check logs
  const txInfo = await erConn.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
  const hasErr = txInfo?.meta?.err;
  if (hasErr) {
    console.log('  TX Error:', JSON.stringify(hasErr));
    txInfo?.meta?.logMessages?.forEach(l => console.log('  ', l));
    assert(false, 'execute_intent failed');
  } else {
    assert(true, `execute_intent OK: ${sig.slice(0, 20)}...`);
  }
} catch (err) {
  console.log('  Error:', err.message?.slice(0, 200));
  assert(false, 'execute_intent failed');
}

// Verify state changed
await sleep(1000);
const erInfo = await erConn.getAccountInfo(capsulePDA);
if (erInfo) {
  const coder = new BorshAccountsCoder(idl);
  const data = coder.decode('IntentCapsule', erInfo.data);
  console.log(`  is_active: ${data.is_active ?? data.isActive} | executed_at: ${(data.executed_at ?? data.executedAt)?.toString()}`);
  assert((data.is_active ?? data.isActive) === false, 'Capsule marked executed on ER');
}

// Step 6: CommitAndUndelegatePermission via Permission Program
// This CPI calls Magic Program's ScheduleCommitAndUndelegate, solving "parent program id: None"
// SDK: CommitAndUndelegatePermissionInstructionData { discriminator: 5 } (borsh u64 LE)
// Accounts: authority, permissioned_account, permission, magic_program, magic_context, [remaining]
console.log('\nStep 6: CommitAndUndelegatePermission (capsule)');
try {
  // Use the Heres program's crank_undelegate (CPI to Magic program) -- the path
  // lib/solana.ts undelegateCapsule uses. Calling the permission program directly
  // (discriminator 5) panics in magicblock-permission state v1.rs; crank_undelegate is correct.
  const crankUndelegateDisc = idl.instructions.find(
    (i) => i.name === 'crank_undelegate' || i.name === 'crankUndelegate'
  )?.discriminator;
  if (!crankUndelegateDisc) throw new Error('crank_undelegate not in IDL');

  const ixCapsule = new TransactionInstruction({
    keys: [
      { pubkey: ownerKp.publicKey, isSigner: true, isWritable: true },     // payer
      { pubkey: capsulePDA, isSigner: false, isWritable: true },           // capsule
      { pubkey: vaultPDA, isSigner: false, isWritable: true },             // vault
      { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },     // magic_context
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },    // magic_program
    ],
    programId: PROGRAM_ID,
    data: Buffer.from(crankUndelegateDisc),
  });

  // Note: vault doesn't have its own permission PDA, need to handle separately

  const { blockhash, lastValidBlockHeight } = await erConn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: ownerKp.publicKey, blockhash, lastValidBlockHeight });
  tx.add(ixCapsule);
  tx.sign(ownerKp);
  const sig = await erConn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await erConn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

  const txInfo = await erConn.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
  if (txInfo?.meta?.err) {
    console.log('  TX Error:', JSON.stringify(txInfo.meta.err));
    txInfo?.meta?.logMessages?.forEach(l => console.log('  ', l));
    assert(false, 'CommitAndUndelegatePermission failed');
  } else {
    console.log(`  TX: ${sig.slice(0, 40)}...`);
    txInfo?.meta?.logMessages?.forEach(l => console.log('  ', l));
    assert(true, 'CommitAndUndelegatePermission sent for capsule + vault');
  }
} catch (err) {
  console.log('  Error:', err.message?.slice(0, 300));
  assert(false, 'CommitAndUndelegatePermission failed');
}

// Step 7: Wait for undelegation
console.log('\nStep 7: Wait 20s for undelegation propagation');
await sleep(20000);
const baseInfo = await conn.getAccountInfo(capsulePDA);
if (baseInfo) {
  console.log(`  Base layer owner: ${baseInfo.owner.toBase58()}`);
  if (baseInfo.owner.equals(PROGRAM_ID)) {
    assert(true, 'Capsule returned to base layer!');
  } else if (baseInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
    assert(false, 'Still delegated (propagation may need more time)');
  } else {
    assert(false, `Unexpected owner: ${baseInfo.owner.toBase58()}`);
  }
} else {
  assert(false, 'Capsule not found on base layer');
}

console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);

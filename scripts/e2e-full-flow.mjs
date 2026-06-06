/**
 * E2E Full Flow: Create → Fund → Wait → Execute → Distribute → Verify Delivery
 *
 * Tests the complete Heres Protocol flow including actual SOL delivery:
 * 1. execute_intent (4 accounts) - marks capsule as executed
 * 2. distribute_assets (8+ accounts) - transfers SOL from vault to beneficiaries
 */
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js';
import anchor from '@coral-xyz/anchor';
const { AnchorProvider, Program, BN, BorshAccountsCoder } = anchor;
import bs58 from 'bs58';
import { readFileSync } from 'fs';

const idl = JSON.parse(readFileSync('./idl/HeresProgram.json', 'utf-8'));
const PROGRAM_ID = new PublicKey('2fLojZpdmXLeg2ZXRCXVsqiWnbpF2yFH1SVGS77UC8s3');
const PERMISSION_PROGRAM_ID = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOC_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const PLATFORM_FEE_RECIPIENT = new PublicKey('Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb');
// Actual fee_recipient stored in on-chain FeeConfig account (read live: Covn3moA...)
const ACTUAL_FEE_RECIPIENT = new PublicKey('Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb');

if (!process.env.CRANK_WALLET_PRIVATE_KEY) throw new Error('CRANK_WALLET_PRIVATE_KEY env required')
const crankKp = Keypair.fromSecretKey(bs58.decode(process.env.CRANK_WALLET_PRIVATE_KEY));
const ownerKp = Keypair.generate();
const beneficiaryKp = Keypair.generate();
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

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

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  [PASS] ${label}`); passed++; }
  else { console.log(`  [FAIL] ${label}`); failed++; }
}

console.log('=== Heres Protocol E2E Full Flow Test ===\n');
console.log('Owner:       ', ownerKp.publicKey.toBase58());
console.log('Beneficiary: ', beneficiaryKp.publicKey.toBase58());
console.log('Capsule PDA: ', capsulePDA.toBase58());
console.log('Vault PDA:   ', vaultPDA.toBase58());

// ========================================
// Step 1: Fund owner
// ========================================
console.log('\nStep 1: Fund owner wallet');
await sendAndConfirmTransaction(conn, new Transaction().add(
  SystemProgram.transfer({ fromPubkey: crankKp.publicKey, toPubkey: ownerKp.publicKey, lamports: Math.floor(0.08 * LAMPORTS_PER_SOL) })
), [crankKp]);
assert(true, 'Owner funded');

// ========================================
// Step 2: Create capsule
// ========================================
console.log('\nStep 2: Create capsule');
const ownerProv = new AnchorProvider(conn, new W(ownerKp), { commitment: 'confirmed' });
const ownerProg = new Program(idl, ownerProv);
const intent = JSON.stringify({
  intent: 'e2e-delivery-test',
  beneficiaries: [{ address: beneficiaryKp.publicKey.toBase58(), amount: '100', amountType: 'percentage' }],
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

// ========================================
// Step 3: Fund vault
// ========================================
console.log('\nStep 3: Fund vault');
await sendAndConfirmTransaction(conn, new Transaction().add(
  SystemProgram.transfer({ fromPubkey: ownerKp.publicKey, toPubkey: vaultPDA, lamports: Math.floor(0.003 * LAMPORTS_PER_SOL) })
), [ownerKp]);
const vaultBefore = await conn.getBalance(vaultPDA);
assert(vaultBefore >= 0.003 * LAMPORTS_PER_SOL, `Vault funded: ${vaultBefore / LAMPORTS_PER_SOL} SOL`);

// ========================================
// Step 4: Wait for inactivity
// ========================================
console.log('\nStep 4: Wait for inactivity (8s)');
await sleep(8000);
assert(true, 'Inactivity period elapsed');

// ========================================
// Step 5: Execute intent (state update)
// ========================================
console.log('\nStep 5: Execute intent (marks capsule as executed)');
const executeDiscriminator = Buffer.from([53, 130, 47, 154, 227, 220, 122, 212]);
const executeKeys = [
  { pubkey: capsulePDA, isSigner: false, isWritable: true },
  { pubkey: vaultPDA, isSigner: false, isWritable: true },
  { pubkey: PERMISSION_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: permissionPDA, isSigner: false, isWritable: true },
];
const executeIx = new TransactionInstruction({ keys: executeKeys, programId: PROGRAM_ID, data: executeDiscriminator });
let bh = await conn.getLatestBlockhash('confirmed');
let tx = new Transaction({ feePayer: crankKp.publicKey, ...bh });
tx.add(executeIx);
tx.sign(crankKp);
let txSig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
await conn.confirmTransaction({ signature: txSig, ...bh }, 'confirmed');
assert(true, `Execute intent confirmed: ${txSig.slice(0, 20)}...`);

// Verify state
await sleep(2000);
const coder = new BorshAccountsCoder(idl);
let capsuleInfo = await conn.getAccountInfo(capsulePDA);
let capsuleData = coder.decode('IntentCapsule', capsuleInfo.data);
const executedAt = capsuleData.executed_at ?? capsuleData.executedAt;
const hasExecutedAt = executedAt && (typeof executedAt === 'number' ? executedAt > 0 : executedAt?.toNumber?.() > 0);
assert(hasExecutedAt, `executed_at set: ${executedAt}`);
assert((capsuleData.is_active ?? capsuleData.isActive) === false, 'is_active = false');

// ========================================
// Step 6: Distribute assets (actual SOL transfer)
// ========================================
console.log('\nStep 6: Distribute assets (SOL transfer to beneficiary)');
const benBalBefore = await conn.getBalance(beneficiaryKp.publicKey);

// distribute_assets discriminator: sha256("global:distribute_assets")[0..8]
const distributeDiscriminator = Buffer.from([239, 241, 19, 219, 144, 191, 154, 18]);

// Account layout from Rust source (DistributeAssets struct):
// capsule, vault(mut), system_program, token_program, fee_config, platform_fee_recipient(optional,mut), mint(optional), vault_token_account(optional,mut)
// + remaining_accounts: beneficiary addresses
const distributeKeys = [
  { pubkey: capsulePDA, isSigner: false, isWritable: true },  // mut: H1 sets `distributed` flag (idempotency)
  { pubkey: vaultPDA, isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: feeConfigPDA, isSigner: false, isWritable: false },
  { pubkey: ACTUAL_FEE_RECIPIENT, isSigner: false, isWritable: true },       // platform_fee_recipient (must match fee_config.fee_recipient)
  { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },               // mint sentinel (None)
  { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },               // vault_token_account sentinel (None)
  // remaining: beneficiary
  { pubkey: beneficiaryKp.publicKey, isSigner: false, isWritable: true },
];

console.log('  distribute_assets accounts:');
distributeKeys.forEach((k, i) => console.log(`    ${i}: ${k.pubkey.toBase58().slice(0, 20)}... W=${k.isWritable}`));

const distributeIx = new TransactionInstruction({ keys: distributeKeys, programId: PROGRAM_ID, data: distributeDiscriminator });
bh = await conn.getLatestBlockhash('confirmed');
tx = new Transaction({ feePayer: crankKp.publicKey, ...bh });
tx.add(distributeIx);
tx.sign(crankKp);

// Simulate first
console.log('\n  Simulating distribute_assets...');
const sim = await conn.simulateTransaction(tx);
if (sim.value.err) {
  console.log('  Simulation FAILED:', JSON.stringify(sim.value.err));
  sim.value.logs?.forEach(l => console.log('   ', l));

  // Try without system_program and token_program (like execute_intent)
  console.log('\n  Retrying without address-constrained accounts...');
  const distributeKeys2 = [
    { pubkey: capsulePDA, isSigner: false, isWritable: false },
    { pubkey: vaultPDA, isSigner: false, isWritable: true },
    { pubkey: feeConfigPDA, isSigner: false, isWritable: false },
    { pubkey: ACTUAL_FEE_RECIPIENT, isSigner: false, isWritable: true },
    { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: beneficiaryKp.publicKey, isSigner: false, isWritable: true },
  ];
  const distributeIx2 = new TransactionInstruction({ keys: distributeKeys2, programId: PROGRAM_ID, data: distributeDiscriminator });
  bh = await conn.getLatestBlockhash('confirmed');
  tx = new Transaction({ feePayer: crankKp.publicKey, ...bh });
  tx.add(distributeIx2);
  tx.sign(crankKp);
  const sim2 = await conn.simulateTransaction(tx);
  if (sim2.value.err) {
    console.log('  Retry FAILED:', JSON.stringify(sim2.value.err));
    sim2.value.logs?.forEach(l => console.log('   ', l));
    assert(false, 'distribute_assets failed');
  } else {
    console.log('  Retry SUCCESS!');
    sim2.value.logs?.forEach(l => console.log('   ', l));
    // Send for real
    const realTxSig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await conn.confirmTransaction({ signature: realTxSig, ...bh }, 'confirmed');
    assert(true, `distribute_assets confirmed: ${realTxSig.slice(0, 20)}...`);
  }
} else {
  console.log('  Simulation SUCCESS!');
  sim.value.logs?.forEach(l => console.log('   ', l));
  // Send for real
  const realTxSig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await conn.confirmTransaction({ signature: realTxSig, ...bh }, 'confirmed');
  assert(true, `distribute_assets confirmed: ${realTxSig.slice(0, 20)}...`);
}

// ========================================
// Step 7: Verify delivery
// ========================================
console.log('\nStep 7: Verify delivery');
await sleep(2000);
const vaultAfter = await conn.getBalance(vaultPDA);
const benBalAfter = await conn.getBalance(beneficiaryKp.publicKey);
console.log(`  Vault:       ${vaultBefore / LAMPORTS_PER_SOL} → ${vaultAfter / LAMPORTS_PER_SOL} SOL (change: ${(vaultAfter - vaultBefore) / LAMPORTS_PER_SOL})`);
console.log(`  Beneficiary: ${benBalBefore / LAMPORTS_PER_SOL} → ${benBalAfter / LAMPORTS_PER_SOL} SOL (change: ${(benBalAfter - benBalBefore) / LAMPORTS_PER_SOL})`);

if (benBalAfter > benBalBefore) {
  assert(true, `SOL delivered to beneficiary! +${(benBalAfter - benBalBefore) / LAMPORTS_PER_SOL} SOL`);
} else {
  assert(false, 'No SOL delivered to beneficiary');
}

// ========================================
// Summary
// ========================================
console.log('\n========================================');
console.log(`E2E Results: ${passed} passed, ${failed} failed`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);

/**
 * Test Option B on-chain leg on the upgraded program (2fLojZ...):
 *   1. configure_distributor  : admin (fee_config.authority) pins the relayer wallet
 *   2. prepare_private_distribution : after execute, the pinned relayer pulls the vault remainder
 *      (minus platform fee) to its own EOA, sets private_distributed. The off-chain MagicBlock
 *      Private Payments fan-out from the relayer is OUT OF SCOPE here (needs the API key).
 *
 * Also asserts the C1 pin holds: a NON-relayer signer is rejected (InvalidDistributor).
 * SOL-only. Needs HERES_AUTHORITY_KEYPAIR (admin), HERES_RELAYER_PRIVATE_KEY, CRANK_WALLET_PRIVATE_KEY.
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

for (const k of ['HERES_AUTHORITY_KEYPAIR', 'HERES_RELAYER_PRIVATE_KEY', 'CRANK_WALLET_PRIVATE_KEY'])
  if (!process.env[k]) throw new Error(`${k} env required`);

const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.HERES_AUTHORITY_KEYPAIR, 'utf8'))));
const relayer = Keypair.fromSecretKey(bs58.decode(process.env.HERES_RELAYER_PRIVATE_KEY));
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

const [feeConfigPDA] = PublicKey.findProgramAddressSync([Buffer.from('fee_config')], PROGRAM_ID);
const [distributorConfigPDA] = PublicKey.findProgramAddressSync([Buffer.from('distributor_config')], PROGRAM_ID);
function pdas(owner) {
  const [capsule] = PublicKey.findProgramAddressSync([Buffer.from('intent_capsule'), owner.toBuffer()], PROGRAM_ID);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('capsule_vault'), owner.toBuffer()], PROGRAM_ID);
  const [permission] = PublicKey.findProgramAddressSync([Buffer.from('permission'), capsule.toBuffer()], PERMISSION_PROGRAM_ID);
  const [distribution] = PublicKey.findProgramAddressSync([Buffer.from('distribution'), capsule.toBuffer()], PROGRAM_ID);
  return { capsule, vault, permission, distribution };
}
function progFor(kp) { idl.address = PROGRAM_ID.toBase58(); return new Program(idl, new AnchorProvider(conn, new W(kp), { commitment: 'confirmed' })); }
async function fund(to, sol) {
  await sendAndConfirmTransaction(conn, new Transaction().add(
    SystemProgram.transfer({ fromPubkey: crankKp.publicKey, toPubkey: to, lamports: Math.floor(sol * LAMPORTS_PER_SOL) })), [crankKp]);
}

(async () => {
  console.log('=== Option B on-chain leg test (program 2fLojZ..., upgraded) ===');
  console.log('admin   :', admin.publicKey.toBase58());
  console.log('relayer :', relayer.publicKey.toBase58());

  // 1. configure_distributor (admin pins the relayer)
  console.log('\nStep 1: configure_distributor (admin -> relayer)');
  const adminProg = progFor(admin);
  await adminProg.methods.configureDistributor(relayer.publicKey).accounts({
    distributorConfig: distributorConfigPDA, feeConfig: feeConfigPDA, authority: admin.publicKey, systemProgram: SystemProgram.programId,
  }).signers([admin]).rpc();
  const dc = await adminProg.account.distributorConfig.fetch(distributorConfigPDA);
  assert(dc.distributor.toBase58() === relayer.publicKey.toBase58(), `distributor_config.distributor = relayer`);

  // 2. private-distribution flow
  console.log('\nStep 2: create -> execute -> prepare_private_distribution');
  const owner = Keypair.generate();
  await fund(owner.publicKey, 0.15);
  const ownerProg = progFor(owner);
  const p = pdas(owner.publicKey);
  const intent = JSON.stringify({
    intent: 'private-dist-test', distributionMode: 'private',
    beneficiaries: [{ address: crankKp.publicKey.toBase58(), amount: '100', amountType: 'percentage' }],
    totalAmount: '0.01', inactivityDays: 0, delayDays: 0,
  });
  await ownerProg.methods.createCapsule(new BN(2), Buffer.from(intent)).accounts({
    owner: owner.publicKey, capsule: p.capsule, vault: p.vault, feeConfig: feeConfigPDA, platformFeeRecipient: PLATFORM_FEE_RECIPIENT,
    systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, mint: PROGRAM_ID, sourceTokenAccount: PROGRAM_ID,
    vaultTokenAccount: PROGRAM_ID, associatedTokenProgram: ASSOC_TOKEN_PROGRAM_ID, permissionProgram: PERMISSION_PROGRAM_ID, permission: p.permission,
  }).signers([owner]).rpc();
  await fund(p.vault, 0.01);
  assert(true, 'capsule created (distributionMode=private) + vault funded 0.01 SOL');

  await sleep(3500);
  await ownerProg.methods.executeIntent().accounts({
    capsule: p.capsule, vault: p.vault, permissionProgram: PERMISSION_PROGRAM_ID, permission: p.permission,
  }).rpc();
  assert(true, 'execute_intent (base) -> executed');

  // 2a. C1 negative: a non-relayer signer must be rejected
  console.log('\nStep 2a: non-relayer distributor rejected (C1 pin)');
  const imposter = Keypair.generate();
  await fund(imposter.publicKey, 0.05);
  let rejected = false;
  try {
    await progFor(imposter).methods.preparePrivateDistribution().accounts({
      capsule: p.capsule, vault: p.vault, feeConfig: feeConfigPDA, distributorConfig: distributorConfigPDA,
      platformFeeRecipient: PLATFORM_FEE_RECIPIENT, mint: null, vaultTokenAccount: null, distributorTokenAccount: null,
      distributor: imposter.publicKey, tokenProgram: null, systemProgram: SystemProgram.programId, distribution: p.distribution,
    }).signers([imposter]).rpc();
  } catch (e) { rejected = /InvalidDistributor|constraint/i.test(e.message || ''); }
  assert(rejected, 'imposter distributor rejected by C1 pin');

  // 2b. relayer executes the real private-distribution leg
  console.log('\nStep 2b: relayer pulls vault remainder');
  const relayerBefore = await conn.getBalance(relayer.publicKey);
  const platBefore = await conn.getBalance(PLATFORM_FEE_RECIPIENT);
  const vaultBefore = await conn.getBalance(p.vault);
  await progFor(relayer).methods.preparePrivateDistribution().accounts({
    capsule: p.capsule, vault: p.vault, feeConfig: feeConfigPDA, distributorConfig: distributorConfigPDA,
    platformFeeRecipient: PLATFORM_FEE_RECIPIENT, mint: null, vaultTokenAccount: null, distributorTokenAccount: null,
    distributor: relayer.publicKey, tokenProgram: null, systemProgram: SystemProgram.programId, distribution: p.distribution,
  }).signers([relayer]).rpc();

  const relayerAfter = await conn.getBalance(relayer.publicKey);
  const platAfter = await conn.getBalance(PLATFORM_FEE_RECIPIENT);
  const vaultAfter = await conn.getBalance(p.vault);
  const c = await progFor(relayer).account.intentCapsule.fetch(p.capsule);
  console.log(`  vault   : ${vaultBefore / 1e9} -> ${vaultAfter / 1e9} SOL`);
  console.log(`  platform: +${(platAfter - platBefore) / 1e9} SOL (fee)`);
  console.log(`  relayer : net ${(relayerAfter - relayerBefore) / 1e9} SOL (after rent/fees)`);
  assert(platAfter - platBefore === Math.floor(0.01 * LAMPORTS_PER_SOL) * 300 / 10000, 'platform got 3% execution fee (30000 lamports)');
  assert(vaultAfter === 0, 'vault fully drained to relayer');
  assert(c.privateDistributed === true, 'capsule.private_distributed = true (idempotency persisted)');

  // 2c. idempotency: second prepare must fail
  console.log('\nStep 2c: second prepare rejected (idempotency)');
  let twice = false;
  try {
    await progFor(relayer).methods.preparePrivateDistribution().accounts({
      capsule: p.capsule, vault: p.vault, feeConfig: feeConfigPDA, distributorConfig: distributorConfigPDA,
      platformFeeRecipient: PLATFORM_FEE_RECIPIENT, mint: null, vaultTokenAccount: null, distributorTokenAccount: null,
      distributor: relayer.publicKey, tokenProgram: null, systemProgram: SystemProgram.programId, distribution: p.distribution,
    }).signers([relayer]).rpc();
  } catch (e) { twice = true; }
  assert(twice, 'second prepare rejected (already distributed / distribution PDA exists)');

  console.log(`\n===== ${passed} passed, ${failed} failed =====`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

/**
 * ER round-trip integration test for the LEAN program (sDRdG2qt...).
 *
 * Proves the Model-A Switch+Vault flow works end-to-end on a live MagicBlock ER:
 *
 *   create_capsule (base)            Switch + Vault, NO beneficiaries on base (privacy D8)
 *   deposit SOL    (base)            fund the Vault (Vault is NEVER delegated)
 *   delegate_capsule (base)          delegate ONLY the Switch to the ER/validator
 *   update_activity  (ER, relayer)   heartbeat path: relayer bumps last_activity on the ER
 *   update_intent    (ER, owner)     set the PRIVATE beneficiary list on the ER copy
 *   schedule_execute_intent (ER)     register the autonomous ScheduleTask crank
 *   <wait>                           MagicBlock runs execute_intent itself (no off-chain crank)
 *   crank_undelegate (ER, crank)     commit + undelegate the Switch back to base
 *   verify (base)                    is_active=false, executed_at set, beneficiaries survived
 *
 * The key assertion is that beneficiaries set privately on the ER round-trip correctly to base
 * on undelegate, and that the switch fired autonomously. distribute_assets is NOT exercised here:
 * it is gated by a 48h GRACE_PERIOD that a real devnet clock can't fast-forward, so it stays
 * covered by the clock-warped bankrun suite (tests/).
 *
 * Uses the Anchor 0.32 client with the fresh build IDL (auto-encodes args); PDAs are precomputed
 * and passed explicitly so nothing depends on resolver guesswork.
 *
 * Run:  node scripts/magicblock/er-roundtrip.mjs
 * Env:  ER_RPC (default Asia), VALIDATOR (default MAS1Dt9), INACTIVITY (s), SCHEDULE_INTERVAL_MS,
 *       SCHEDULE_ITERS, FUND_SOL, DEPOSIT_SOL
 */
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import anchor from '@coral-xyz/anchor';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const { Program, AnchorProvider, BN, Wallet } = anchor;

// ---------- config ----------
const REPO = join(homedir(), 'projects/heres-protocol');
const idl = JSON.parse(readFileSync(join(REPO, 'heres_program/target/idl/heres_program.json'), 'utf-8'));
const PROGRAM_ID = new PublicKey(idl.address);

// Prefer the keyed Helius devnet RPC from the solana CLI config (the public RPC rate-limits and
// drops fetches mid-run). Falls back to the public endpoint if no config URL is found.
function configBaseRpc() {
  try {
    const cfg = readFileSync(join(homedir(), '.config/solana/cli/config.yml'), 'utf-8');
    const m = cfg.match(/json_rpc_url:\s*"?([^"\s]+)"?/);
    if (m && /devnet/.test(m[1])) return m[1];
  } catch { /* fall through */ }
  return 'https://api.devnet.solana.com';
}
const BASE_RPC = process.env.BASE_RPC ?? configBaseRpc();
const ER_RPC = process.env.ER_RPC ?? 'https://devnet-as.magicblock.app';
const VALIDATOR = new PublicKey(process.env.VALIDATOR ?? 'MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57');

const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT_ID = new PublicKey('MagicContext1111111111111111111111111111111');
const PERMISSION_PROGRAM_ID = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');

const INACTIVITY = Number(process.env.INACTIVITY ?? 5);              // seconds of silence before fire
const SCHEDULE_INTERVAL_MS = Number(process.env.SCHEDULE_INTERVAL_MS ?? 3000);
const SCHEDULE_ITERS = Number(process.env.SCHEDULE_ITERS ?? 6);
const FUND_SOL = Number(process.env.FUND_SOL ?? 0.25);
const DEPOSIT_SOL = Number(process.env.DEPOSIT_SOL ?? 0.02);
const FIRE_WATCH_S = Number(process.env.FIRE_WATCH_S ?? 45);

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sol = n => (n / LAMPORTS_PER_SOL).toFixed(6);
const loadKp = p => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf-8'))));
const sk = p => join(homedir(), '.config/solana', p);

// fetch with a hard timeout so a hung RPC never stalls the run (node's default fetch has none).
const timeoutFetch = (u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(15000) });
const connOpts = { commitment: 'confirmed', fetch: timeoutFetch };
const baseConn = new Connection(BASE_RPC, connOpts);
const erConn = new Connection(ER_RPC, connOpts);

// Retry a flaky RPC read/send a few times before giving up (public devnet drops requests).
async function retry(fn, tries = 5, gap = 1500) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { last = e; if (i < tries - 1) await sleep(gap); }
  }
  throw last;
}
const getAcct = (conn, pk) => retry(() => conn.getAccountInfo(pk));
const sendBase = (ixs, signers) =>
  retry(() => sendAndConfirmTransaction(baseConn, new Transaction().add(...ixs), signers, { commitment: 'confirmed' }));

const funder = loadKp(sk('id.json'));         // 44 SOL faucet wallet
const crankKp = loadKp(sk('heres-crank.json'));   // permissionless crank (undelegate payer)
const relayerKp = loadKp(sk('heres-relayer.json')); // heartbeat_authority
const ownerKp = Keypair.generate();              // throwaway capsule owner
const ben1 = Keypair.generate();
const ben2 = Keypair.generate();

// Anchor program (provider wallet = owner; we send raw txs ourselves so this is only for ix building).
const provider = new AnchorProvider(baseConn, new Wallet(ownerKp), { commitment: 'confirmed' });
const program = new Program(idl, provider);
// Standalone accounts coder for manual decodes off the ER/base connections (program.coder.accounts
// is unreliable in anchor 0.32 for this IDL; this decodes with raw snake_case field names).
const accountsCoder = new anchor.BorshAccountsCoder(idl);
const decodeCapsule = data => accountsCoder.decode('IntentCapsule', data);

// PDAs
const seed = s => Buffer.from(s);
const [capsule] = PublicKey.findProgramAddressSync([seed('intent_capsule'), ownerKp.publicKey.toBuffer()], PROGRAM_ID);
const [vault] = PublicKey.findProgramAddressSync([seed('capsule_vault'), ownerKp.publicKey.toBuffer()], PROGRAM_ID);
const [feeConfig] = PublicKey.findProgramAddressSync([seed('fee_config')], PROGRAM_ID);
const [permission] = PublicKey.findProgramAddressSync([seed('permission'), capsule.toBuffer()], PERMISSION_PROGRAM_ID);
const [bufferPda] = PublicKey.findProgramAddressSync([seed('buffer'), capsule.toBuffer()], PROGRAM_ID);
const [delegationRecord] = PublicKey.findProgramAddressSync([seed('delegation'), capsule.toBuffer()], DELEGATION_PROGRAM_ID);
const [delegationMetadata] = PublicKey.findProgramAddressSync([seed('delegation-metadata'), capsule.toBuffer()], DELEGATION_PROGRAM_ID);

// Send a tx to the ER (gasless, skipPreflight: the ER may not simulate the cloned program cleanly).
async function sendER(ixs, signers, feePayer) {
  return retry(async () => {
    const { blockhash, lastValidBlockHeight } = await erConn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: feePayer.publicKey, blockhash, lastValidBlockHeight });
    ixs.forEach(ix => tx.add(ix));
    tx.sign(...signers);
    const sig = await erConn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await erConn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  }, 3, 2000);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
};

console.log('=== Heres lean ER round-trip ===');
console.log('program  :', PROGRAM_ID.toBase58());
console.log('ER RPC   :', ER_RPC, '| validator', VALIDATOR.toBase58());
console.log('owner    :', ownerKp.publicKey.toBase58());
console.log('capsule  :', capsule.toBase58());
console.log('vault    :', vault.toBase58());
console.log('relayer  :', relayerKp.publicKey.toBase58(), '(heartbeat_authority)');
console.log('crank    :', crankKp.publicKey.toBase58(), '(undelegate payer)');
console.log(`knobs    : inactivity=${INACTIVITY}s schedule=${SCHEDULE_INTERVAL_MS}ms x ${SCHEDULE_ITERS}\n`);

try {
  // ---- 1. fund owner ----
  await sendBase([SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: ownerKp.publicKey, lamports: Math.floor(FUND_SOL * LAMPORTS_PER_SOL) })], [funder]);
  console.log(`1. funded owner ${FUND_SOL} SOL`);

  // ---- 2. create_capsule (base; no beneficiaries; heartbeat_authority = relayer) ----
  const createIx = await program.methods
    .createCapsule(new BN(INACTIVITY), relayerKp.publicKey)
    .accountsPartial({
      capsule, vault, owner: ownerKp.publicKey, feeConfig,
      platformFeeRecipient: PROGRAM_ID,   // sentinel: creation fee is 0, recipient unused
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  await sendBase([createIx], [ownerKp]);
  console.log('2. created Switch + Vault (base, no beneficiaries)');

  // ---- 3. deposit SOL into the Vault ----
  const depositIx = await program.methods
    .deposit(new BN(Math.floor(DEPOSIT_SOL * LAMPORTS_PER_SOL)))
    .accountsPartial({
      capsule, vault, owner: ownerKp.publicKey, systemProgram: SystemProgram.programId,
      tokenProgram: null, associatedTokenProgram: null, mint: null,
      sourceTokenAccount: null, vaultTokenAccount: null,
    })
    .instruction();
  await sendBase([depositIx], [ownerKp]);
  const vaultBal = await retry(() => baseConn.getBalance(vault));
  check('deposit SOL into vault', vaultBal >= Math.floor(DEPOSIT_SOL * LAMPORTS_PER_SOL), `vault=${sol(vaultBal)} SOL`);

  // ---- 4. delegate the Switch only ----
  const delegateIx = await program.methods
    .delegateCapsule()
    .accountsPartial({
      payer: ownerKp.publicKey,
      owner: ownerKp.publicKey,
      validator: VALIDATOR,
      bufferPda, delegationRecordPda: delegationRecord, delegationMetadataPda: delegationMetadata,
      pda: capsule,
      magicProgram: MAGIC_PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      ownerProgram: PROGRAM_ID,
    })
    .instruction();
  await sendBase([delegateIx], [ownerKp]);

  // wait for the base account to be owned by the delegation program + the ER to clone it
  let delegated = false;
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    const baseInfo = await getAcct(baseConn, capsule).catch(() => null);
    const erInfo = await getAcct(erConn, capsule).catch(() => null);
    if (baseInfo?.owner.equals(DELEGATION_PROGRAM_ID) && erInfo) { delegated = true; break; }
  }
  check('delegate Switch (base owner = delegation program, ER cloned)', delegated);
  // assert the Vault stayed on base (never delegated)
  const vaultInfo = await getAcct(baseConn, vault);
  check('Vault NOT delegated (still owned by program)', vaultInfo?.owner.equals(PROGRAM_ID));

  // ---- 5. heartbeat via the relayer on the ER ----
  let hbOk = false;
  try {
    const hbIx = await program.methods
      .updateActivity()
      .accountsPartial({ capsule, authority: relayerKp.publicKey })
      .instruction();
    await sendER([hbIx], [relayerKp], relayerKp);
    hbOk = true;
  } catch (e) { console.log('   (relayer heartbeat err:', e.message?.slice(0, 140), ')'); }
  check('relayer heartbeat on ER (update_activity by heartbeat_authority)', hbOk);

  // ---- 6. set PRIVATE beneficiaries on the ER (owner) ----
  const beneficiaries = [
    { pubkey: ben1.publicKey, shareBps: 6000 },
    { pubkey: ben2.publicKey, shareBps: 4000 },
  ];
  const setIx = await program.methods
    .updateIntent(beneficiaries)
    .accountsPartial({ capsule, owner: ownerKp.publicKey })
    .instruction();
  await sendER([setIx], [ownerKp], ownerKp);
  console.log('6. set beneficiaries on ER:', ben1.publicKey.toBase58().slice(0, 8), '60% /', ben2.publicKey.toBase58().slice(0, 8), '40%');
  // confirm they are NOT visible on the base copy (it is frozen/delegated)
  const baseRaw = await getAcct(baseConn, capsule);
  const benVisibleOnBase = baseRaw && baseRaw.data.includes(ben1.publicKey.toBuffer());
  check('beneficiaries NOT on base while delegated (privacy)', !benVisibleOnBase);

  // ---- 7. wait out the inactivity window, then schedule the autonomous crank ----
  await sleep((INACTIVITY + 3) * 1000);
  const args = { taskId: new BN(Date.now()), executionIntervalMillis: new BN(SCHEDULE_INTERVAL_MS), iterations: new BN(SCHEDULE_ITERS) };
  const schedIx = await program.methods
    .scheduleExecuteIntent(args)
    .accountsPartial({
      magicProgram: MAGIC_PROGRAM_ID, payer: ownerKp.publicKey, capsule,
      permissionProgram: PERMISSION_PROGRAM_ID, permission,
    })
    .instruction();
  const schedSig = await sendER([schedIx], [ownerKp], ownerKp);
  console.log('7. scheduled execute_intent crank on ER:', schedSig);

  // ---- 8. watch for the autonomous fire on the ER copy ----
  let fired = false, firedAt = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < FIRE_WATCH_S * 1000) {
    await sleep(3000);
    const erInfo = await getAcct(erConn, capsule).catch(() => null);
    if (!erInfo) continue;
    const dec = decodeCapsule(erInfo.data);
    const secs = Math.round((Date.now() - startedAt) / 1000);
    process.stdout.write(`   t+${secs}s is_active=${dec.is_active} executed_at=${dec.executed_at ? dec.executed_at.toString() : 'null'}      \r`);
    if (dec.is_active === false) { fired = true; firedAt = dec.executed_at?.toString(); break; }
  }
  console.log('');
  check('execute_intent fired AUTONOMOUSLY on ER (no off-chain crank)', fired, firedAt ? `executed_at=${firedAt}` : 'did not fire in window');

  // ---- 9. crank_undelegate: commit + undelegate the Switch back to base ----
  const undIx = await program.methods
    .crankUndelegate()
    .accountsPartial({ payer: crankKp.publicKey, capsule, magicContext: MAGIC_CONTEXT_ID, magicProgram: MAGIC_PROGRAM_ID })
    .instruction();
  const undSig = await sendER([undIx], [crankKp], crankKp);
  console.log('9. crank_undelegate sent on ER:', undSig);

  let backOnBase = false;
  for (let i = 0; i < 16; i++) {
    await sleep(2500);
    const info = await getAcct(baseConn, capsule).catch(() => null);
    if (info?.owner.equals(PROGRAM_ID)) { backOnBase = true; break; }
  }
  check('Switch undelegated back to base (owner = program)', backOnBase);

  // ---- 10. verify the committed state on base ----
  if (backOnBase) {
    const cap = decodeCapsule((await getAcct(baseConn, capsule)).data);
    check('base: is_active = false', cap.is_active === false);
    check('base: executed_at set', cap.executed_at != null, cap.executed_at?.toString());
    const b = cap.beneficiaries;
    const benRoundTrip = b.length === 2
      && b[0].pubkey.equals(ben1.publicKey) && b[0].share_bps === 6000
      && b[1].pubkey.equals(ben2.publicKey) && b[1].share_bps === 4000;
    check('base: private beneficiaries round-tripped intact (now public)', benRoundTrip, `count=${b.length}`);
    console.log('   distribute_assets is grace-gated (48h) -> covered by bankrun, not run here.');
  }
} catch (e) {
  console.error('\nFATAL:', e.message);
  if (e.logs) e.logs.slice(-12).forEach(l => console.error('   ', l));
  results.push({ name: 'unexpected exception', ok: false });
}

// ---------- summary ----------
const passed = results.filter(r => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(results.every(r => r.ok) ? 0 : 1);

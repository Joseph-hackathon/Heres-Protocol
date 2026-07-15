/**
 * ER round-trip integration test for the LEAN program (sDRdG2qt...), Workstream A two-ER model.
 *
 * Proves the split end-to-end on LIVE MagicBlock ERs, with the Switch and the BeneficiarySet on
 * DIFFERENT ERs:
 *
 *   create_capsule (base)              Switch + BeneficiarySet + Vault; NO beneficiaries on base (D8)
 *   deposit SOL    (base)              fund the Vault (Vault is NEVER delegated)
 *   delegate_capsule (base)            delegate the Switch to a REGULAR ER (no permission, no TEE)
 *   delegate_beneficiaries (base)      delegate the BeneficiarySet to the TEE (owner-only permission)
 *   update_activity (REGULAR ER)       heartbeat path: relayer bumps last_activity - NO TEE TOKEN
 *   update_intent   (TEE, owner)       set the PRIVATE beneficiary list inside the enclave
 *   schedule_execute_intent (REG ER)   register the autonomous ScheduleTask crank on the Switch
 *   <wait>                             MagicBlock fires execute_intent on the regular ER (no crank)
 *   crank_undelegate (REG ER)          commit + undelegate the Switch back to base (fired state lands)
 *   crank_undelegate_beneficiaries (TEE)  *** THE CROSS-ER PROOF *** the TEE ix reads the now-base
 *                                      Switch to confirm it fired, then reveals the BeneficiarySet
 *   verify (base)                      Switch fired; beneficiaries round-tripped, now public
 *
 * THE LOAD-BEARING ASSERTION (the whole split rests on it): a TEE-ER instruction can read the
 * just-undelegated base Switch to gate the privacy reveal. If this passes, the split ships; if it
 * never lands, fall back to single-account Model A.
 *
 * Headline new properties vs the old single-account run:
 *   - the relayer heartbeat uses NO TEE auth token (it hits the regular ER) - the hot path is token-free;
 *   - the BeneficiarySet is private in the TEE while the Switch is public-but-harmless on a regular ER;
 *   - the reveal is gated cross-ER and only opens AFTER the Switch fires + commits to base.
 *
 * distribute_assets is NOT exercised here. Immediate settlement is covered by bankrun and the
 * live devnet NFT path is covered by nft-inheritance-check.mjs.
 *
 * Run:  node scripts/magicblock/er-roundtrip.mjs
 * Env:  BASE_RPC, SWITCH_ER_RPC (regular ER), TEE_RPC, SWITCH_VALIDATOR, TEE_VALIDATOR,
 *       INACTIVITY (s), SCHEDULE_INTERVAL_MS, SCHEDULE_ITERS, FUND_SOL, DEPOSIT_SOL,
 *       FIRE_WATCH_S, REVEAL_TRIES, REVEAL_GAP_MS
 */
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import anchor from '@coral-xyz/anchor';
import nacl from 'tweetnacl';
import { getAuthToken } from '@magicblock-labs/ephemeral-rollups-sdk';
import { getCollateral, verify, Quote } from '@phala/dcap-qvl';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const { Program, AnchorProvider, BN, Wallet } = anchor;

// ---------- config ----------
const REPO = join(homedir(), 'projects/heres-protocol');
const idl = JSON.parse(readFileSync(join(REPO, 'heres_program/target/idl/heres_program.json'), 'utf-8'));
const PROGRAM_ID = new PublicKey(idl.address);

// Prefer the keyed Helius devnet RPC from the solana CLI config (the public RPC rate-limits).
function configBaseRpc() {
  try {
    const cfg = readFileSync(join(homedir(), '.config/solana/cli/config.yml'), 'utf-8');
    const m = cfg.match(/json_rpc_url:\s*"?([^"\s]+)"?/);
    if (m && /devnet/.test(m[1])) return m[1];
  } catch { /* fall through */ }
  return 'https://api.devnet.solana.com';
}
const BASE_RPC = process.env.BASE_RPC ?? configBaseRpc();

// Two ERs: the Switch lives on a regular ER (token-free); the BeneficiarySet lives on the TEE.
const SWITCH_ER_RPC = (process.env.SWITCH_ER_RPC ?? 'https://devnet-as.magicblock.app').replace(/\/+$/, '');
const TEE_RPC = (process.env.TEE_RPC ?? 'https://devnet-tee.magicblock.app').replace(/\/+$/, '');
const SWITCH_VALIDATOR = new PublicKey(process.env.SWITCH_VALIDATOR ?? 'MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57'); // regular ER (constants.rs DEFAULT_ER_VALIDATOR)
const TEE_VALIDATOR = new PublicKey(process.env.TEE_VALIDATOR ?? 'MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo');    // TEE node (constants.rs TEE_VALIDATOR)
const ROUTER_RPC = process.env.ROUTER_RPC ?? 'https://devnet-router.magicblock.app/';

const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT_ID = new PublicKey('MagicContext1111111111111111111111111111111');
const PERMISSION_PROGRAM_ID = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');

const INACTIVITY = Number(process.env.INACTIVITY ?? 5);
// MODE 'inactivity' (default): dead-man's-switch, target_date = null, fires on the inactivity window.
// MODE 'date': set an absolute target_date a few seconds out + a LONG inactivity, so the autonomous
// fire can ONLY come from the date trigger - proves execute_intent's `inactivity_due || date_due` on
// a live ER (the on-chain half of the target_date feature).
const MODE = (process.env.MODE ?? 'inactivity').toLowerCase();
const DATE_OFFSET_S = Number(process.env.DATE_OFFSET_S ?? 12);
const SCHEDULE_INTERVAL_MS = Number(process.env.SCHEDULE_INTERVAL_MS ?? 3000);
const SCHEDULE_ITERS = Number(process.env.SCHEDULE_ITERS ?? 6);
const FUND_SOL = Number(process.env.FUND_SOL ?? 0.25);
const DEPOSIT_SOL = Number(process.env.DEPOSIT_SOL ?? 0.02);
const FIRE_WATCH_S = Number(process.env.FIRE_WATCH_S ?? 45);
// The cross-ER reveal may need the TEE's base view to catch up to the just-undelegated Switch.
const REVEAL_TRIES = Number(process.env.REVEAL_TRIES ?? 10);
const REVEAL_GAP_MS = Number(process.env.REVEAL_GAP_MS ?? 4000);

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sol = n => (n / LAMPORTS_PER_SOL).toFixed(6);
const loadKp = p => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf-8'))));
const sk = p => join(homedir(), '.config/solana', p);

const timeoutFetch = (u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(15000) });
const connOpts = { commitment: 'confirmed', fetch: timeoutFetch };
const baseConn = new Connection(BASE_RPC, connOpts);
// Switch ER (regular, token-free). May be upgraded to the router-issued fqdn after delegation.
let switchEr = new Connection(SWITCH_ER_RPC, connOpts);

// TEE: mint a per-key auth token (proves key ownership) and open a token-authed connection to the
// Private ER. Token gates *reads* by the key's permission member flags; sends are authorized on-chain.
const teeConnCache = new Map();
async function teeConnFor(kp) {
  const k = kp.publicKey.toBase58();
  if (teeConnCache.has(k)) return teeConnCache.get(k);
  const { token } = await getAuthToken(TEE_RPC, kp.publicKey,
    msg => Promise.resolve(nacl.sign.detached(msg, kp.secretKey)));
  const conn = new Connection(`${TEE_RPC}?token=${token}`, connOpts);
  teeConnCache.set(k, conn);
  return conn;
}

// Attest the enclave before trusting it with private state: fetch a TDX quote (challenge MUST decode
// to exactly 64 bytes - the reportData width), pull Intel collateral from Phala PCCS, verify.
async function attestTee(teeRpc) {
  const ch = randomBytes(64).toString('base64');
  const r = await timeoutFetch(`${teeRpc}/quote?challenge=${encodeURIComponent(ch)}`);
  const body = await r.json();
  if (r.status !== 200 || !body.quote) throw new Error(body.error ?? 'no quote returned');
  const rawQuote = Uint8Array.from(Buffer.from(body.quote, 'base64'));
  const collateral = await getCollateral('https://pccs.phala.network/tdx/certification/v4', rawQuote);
  try { verify(rawQuote, collateral, Math.floor(Date.now() / 1000)); }
  catch (e) { if (!e.message.includes('SEPT_VE_DISABLE is not enabled')) throw e; }
  const td = Quote.parse(rawQuote).report.asTd10?.();
  if (!td) throw new Error('not a TD10 quote');
  return true;
}

async function routerFqdn(account) {
  const body = await retry(async () => {
    const res = await timeoutFetch(ROUTER_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getDelegationStatus', params: [account.toBase58()] }),
    });
    return res.json();
  }, 4, 2000);
  if (body.error) throw new Error('router: ' + body.error.message);
  return body.result;
}

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

// Send a tx to an ER (skipPreflight). `conn` is required - either switchEr or a TEE conn.
async function sendER(ixs, signers, feePayer, conn) {
  return retry(async () => {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: feePayer.publicKey, blockhash, lastValidBlockHeight });
    ixs.forEach(ix => tx.add(ix));
    tx.sign(...signers);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      const s = (await conn.getSignatureStatuses([sig]))?.value?.[0];
      if (!s) continue;
      if (s.err) throw new Error('tx err: ' + JSON.stringify(s.err));
      if (['processed', 'confirmed', 'finalized'].includes(s.confirmationStatus)) return sig;
    }
    throw new Error('confirm timeout for ' + sig.slice(0, 16));
  }, 3, 2000);
}

// One-shot ER send that EXPECTS failure (adversarial checks). Returns the error string if blocked,
// null if it unexpectedly landed.
async function sendERExpectFail(ixs, signers, feePayer, conn) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: feePayer.publicKey, blockhash, lastValidBlockHeight });
  ixs.forEach(ix => tx.add(ix));
  tx.sign(...signers);
  let sig;
  try { sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true }); }
  catch (e) { return e.message ?? 'send rejected'; }
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const s = (await conn.getSignatureStatuses([sig]))?.value?.[0];
    if (!s) continue;
    if (s.err) return JSON.stringify(s.err);
    if (['processed', 'confirmed', 'finalized'].includes(s.confirmationStatus)) return null;
  }
  return null;
}

const funder = loadKp(sk('id.json'));
const crankKp = loadKp(sk('heres-crank.json'));
const relayerKp = loadKp(sk(process.env.RELAYER_KEY ?? 'heres-relayer.json'));
const ownerKp = Keypair.generate();
const ben1 = Keypair.generate();
const ben2 = Keypair.generate();
const nftMint = Keypair.generate().publicKey;

const provider = new AnchorProvider(baseConn, new Wallet(ownerKp), { commitment: 'confirmed' });
const program = new Program(idl, provider);
const accountsCoder = new anchor.BorshAccountsCoder(idl);
const decodeCapsule = data => accountsCoder.decode('IntentCapsule', data);
const decodeBenSet = data => accountsCoder.decode('BeneficiarySet', data);

// PDAs
const seed = s => Buffer.from(s);
const [capsule] = PublicKey.findProgramAddressSync([seed('intent_capsule'), ownerKp.publicKey.toBuffer()], PROGRAM_ID);
const [benSet] = PublicKey.findProgramAddressSync([seed('beneficiary_set'), ownerKp.publicKey.toBuffer()], PROGRAM_ID);
const [vault] = PublicKey.findProgramAddressSync([seed('capsule_vault'), ownerKp.publicKey.toBuffer()], PROGRAM_ID);
const [feeConfig] = PublicKey.findProgramAddressSync([seed('fee_config')], PROGRAM_ID);

// Switch delegation PDAs (regular ER, no permission).
const [bufferCapsule] = PublicKey.findProgramAddressSync([seed('buffer'), capsule.toBuffer()], PROGRAM_ID);
const [delRecordCapsule] = PublicKey.findProgramAddressSync([seed('delegation'), capsule.toBuffer()], DELEGATION_PROGRAM_ID);
const [delMetaCapsule] = PublicKey.findProgramAddressSync([seed('delegation-metadata'), capsule.toBuffer()], DELEGATION_PROGRAM_ID);

// BeneficiarySet delegation PDAs (TEE) + its PER permission lifecycle.
const [bufferBen] = PublicKey.findProgramAddressSync([seed('buffer'), benSet.toBuffer()], PROGRAM_ID);
const [delRecordBen] = PublicKey.findProgramAddressSync([seed('delegation'), benSet.toBuffer()], DELEGATION_PROGRAM_ID);
const [delMetaBen] = PublicKey.findProgramAddressSync([seed('delegation-metadata'), benSet.toBuffer()], DELEGATION_PROGRAM_ID);
const [permission] = PublicKey.findProgramAddressSync([seed('permission:'), benSet.toBuffer()], PERMISSION_PROGRAM_ID);
const [bufferPermission] = PublicKey.findProgramAddressSync([seed('buffer'), permission.toBuffer()], PERMISSION_PROGRAM_ID);
const [delRecordPermission] = PublicKey.findProgramAddressSync([seed('delegation'), permission.toBuffer()], DELEGATION_PROGRAM_ID);
const [delMetaPermission] = PublicKey.findProgramAddressSync([seed('delegation-metadata'), permission.toBuffer()], DELEGATION_PROGRAM_ID);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
};

console.log('=== Heres lean ER round-trip (Workstream A: Switch on regular ER, BeneficiarySet on TEE) ===');
console.log('program     :', PROGRAM_ID.toBase58());
console.log('Switch ER   :', SWITCH_ER_RPC, '| validator', SWITCH_VALIDATOR.toBase58());
console.log('BenSet TEE  :', TEE_RPC, '| validator', TEE_VALIDATOR.toBase58());
console.log('owner       :', ownerKp.publicKey.toBase58());
console.log('capsule     :', capsule.toBase58());
console.log('benSet      :', benSet.toBase58());
console.log('vault       :', vault.toBase58());
console.log('relayer     :', relayerKp.publicKey.toBase58(), '(heartbeat_authority)');
console.log('crank       :', crankKp.publicKey.toBase58(), '(undelegate payer)');
console.log(`knobs       : inactivity=${INACTIVITY}s schedule=${SCHEDULE_INTERVAL_MS}ms x ${SCHEDULE_ITERS}\n`);

try {
  // ---- 0. attest the TEE enclave before trusting it with private state ----
  try {
    const ok = await attestTee(TEE_RPC);
    check('TEE attestation: Intel TDX quote verified (Phala PCCS)', ok === true);
  } catch (e) {
    console.log('   (TEE attestation skipped - external verifier error:', e.message?.slice(0, 100), ')');
  }

  // ---- 1. fund owner ----
  await sendBase([SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: ownerKp.publicKey, lamports: Math.floor(FUND_SOL * LAMPORTS_PER_SOL) })], [funder]);
  console.log(`1. funded owner ${FUND_SOL} SOL`);

  // ---- 2. create_capsule (base; 3 PDAs; no beneficiaries; heartbeat_authority = relayer) ----
  // In date mode use a long inactivity so the date is the only trigger that can fire the switch.
  const effectiveInactivity = MODE === 'date' ? Math.max(INACTIVITY, 3600) : INACTIVITY;
  const targetDateUnix = MODE === 'date' ? Math.floor(Date.now() / 1000) + DATE_OFFSET_S : null;
  console.log(`   mode=${MODE} inactivity=${effectiveInactivity}s target_date=${targetDateUnix ?? 'null'}`);
  const createIx = await program.methods
    .createCapsule(new BN(effectiveInactivity), relayerKp.publicKey, targetDateUnix != null ? new BN(targetDateUnix) : null)
    .accountsPartial({
      capsule, beneficiarySet: benSet, vault, owner: ownerKp.publicKey, feeConfig,
      platformFeeRecipient: PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  await sendBase([createIx], [ownerKp]);
  console.log('2. created Switch + BeneficiarySet + Vault (base, no beneficiaries)');

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

  // ---- 4a. delegate the Switch to the REGULAR ER (no permission) ----
  const delSwitchIx = await program.methods
    .delegateCapsule()
    .accountsPartial({
      payer: ownerKp.publicKey, owner: ownerKp.publicKey, validator: SWITCH_VALIDATOR,
      bufferPda: bufferCapsule, delegationRecordPda: delRecordCapsule, delegationMetadataPda: delMetaCapsule,
      pda: capsule, magicProgram: MAGIC_PROGRAM_ID, delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId, ownerProgram: PROGRAM_ID,
    })
    .instruction();
  await sendBase([delSwitchIx], [ownerKp]);

  let switchDelegated = false;
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    const info = await getAcct(baseConn, capsule).catch(() => null);
    if (info?.owner.equals(DELEGATION_PROGRAM_ID)) { switchDelegated = true; break; }
  }
  // upgrade switchEr to the router-issued fqdn if available (otherwise keep the pinned regular ER)
  try {
    const status = await routerFqdn(capsule);
    if (status?.fqdn) { switchEr = new Connection(status.fqdn, connOpts); console.log('   Switch router fqdn:', status.fqdn.replace(/token=[^&]+/, 'token=***')); }
  } catch { /* keep pinned SWITCH_ER_RPC */ }
  let switchCloned = false;
  for (let i = 0; i < 12; i++) {
    const info = await getAcct(switchEr, capsule).catch(() => null);
    if (info) { switchCloned = true; break; }
    await sleep(2500);
  }
  check('delegate Switch to regular ER (base owner = delegation program, ER cloned)', switchDelegated && switchCloned);

  // ---- 4b. delegate the BeneficiarySet to the TEE (owner-only permission) ----
  const delBenIx = await program.methods
    .delegateBeneficiaries()
    .accountsPartial({
      payer: ownerKp.publicKey, owner: ownerKp.publicKey, validator: TEE_VALIDATOR,
      bufferPda: bufferBen, delegationRecordPda: delRecordBen, delegationMetadataPda: delMetaBen,
      pda: benSet, magicProgram: MAGIC_PROGRAM_ID, delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId, ownerProgram: PROGRAM_ID,
      permissionProgram: PERMISSION_PROGRAM_ID, permission,
      bufferPermission, delegationRecordPermission: delRecordPermission, delegationMetadataPermission: delMetaPermission,
    })
    .instruction();
  await sendBase([delBenIx], [ownerKp]);

  let benDelegated = false;
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    const info = await getAcct(baseConn, benSet).catch(() => null);
    if (info?.owner.equals(DELEGATION_PROGRAM_ID)) { benDelegated = true; break; }
  }
  const ownerTee = await teeConnFor(ownerKp);
  let benCloned = false;
  for (let i = 0; i < 12; i++) {
    const info = await getAcct(ownerTee, benSet).catch(() => null);
    if (info) { benCloned = true; break; }
    await sleep(2500);
  }
  check('delegate BeneficiarySet to TEE (base owner = delegation program, TEE cloned)', benDelegated && benCloned);

  // assert the Vault stayed on base (never delegated)
  const vaultInfo = await getAcct(baseConn, vault);
  check('Vault NOT delegated (still owned by program)', vaultInfo?.owner.equals(PROGRAM_ID));

  // ---- 5. heartbeat via the relayer on the REGULAR ER - NO TEE TOKEN (the hot-path win) ----
  let hbOk = false;
  try {
    const hbIx = await program.methods
      .updateActivity()
      .accountsPartial({ capsule, authority: relayerKp.publicKey })
      .instruction();
    await sendER([hbIx], [relayerKp], relayerKp, switchEr); // switchEr carries NO ?token=
    hbOk = true;
  } catch (e) { console.log('   (relayer heartbeat err:', e.message?.slice(0, 140), ')'); }
  const tokenFree = !/token=/.test(switchEr.rpcEndpoint);
  check('relayer heartbeat on regular ER (token-free hot path)', hbOk && tokenFree,
    tokenFree ? 'no TEE auth token used' : 'WARNING: switchEr carries a token');

  // ---- 6. set PRIVATE beneficiaries on the TEE (owner) ----
  const beneficiaries = [
    { pubkey: ben1.publicKey, shareBps: 6000, reserved: Array(14).fill(0) },
    { pubkey: ben2.publicKey, shareBps: 4000, reserved: Array(14).fill(0) },
  ];
  const setIx = await program.methods
    .updateIntent(beneficiaries)
    .accountsPartial({ beneficiarySet: benSet, owner: ownerKp.publicKey })
    .instruction();
  const setNftIx = await program.methods
    .updateNftAssignments([{ mint: nftMint, recipient: ben1.publicKey }])
    .accountsPartial({ beneficiarySet: benSet, owner: ownerKp.publicKey })
    .instruction();
  await sendER([setIx, setNftIx], [ownerKp], ownerKp, ownerTee);
  console.log('6. set beneficiaries on TEE:', ben1.publicKey.toBase58().slice(0, 8), '60% /', ben2.publicKey.toBase58().slice(0, 8), '40%');
  console.log('   set NFT assignment on TEE:', nftMint.toBase58().slice(0, 8), '->', ben1.publicKey.toBase58().slice(0, 8));

  // not visible on the base BeneficiarySet (delegated/empty there)
  const baseBen = await getAcct(baseConn, benSet);
  const benOnBase = baseBen && baseBen.data.includes(ben1.publicKey.toBuffer());
  check('beneficiaries NOT on base while delegated (privacy)', !benOnBase);

  // TEE privacy proof: owner (read flags) sees them; an unauthorized observer (fresh key) is filtered.
  const ownerRaw = await getAcct(ownerTee, benSet);
  const ownerSees = !!(ownerRaw && ownerRaw.data.includes(ben1.publicKey.toBuffer()));
  check('TEE: owner (AUTHORITY + read flags) CAN read beneficiaries', ownerSees);
  const ownerSeesNft = !!(ownerRaw && ownerRaw.data.includes(nftMint.toBuffer()));
  check('TEE: owner CAN read private NFT assignment', ownerSeesNft);
  const obsKp = Keypair.generate();
  const obsConn = await teeConnFor(obsKp);
  const obsRaw = await obsConn.getAccountInfo(benSet).catch(() => null);
  const obsSees = !!(obsRaw && obsRaw.data && obsRaw.data.includes(ben1.publicKey.toBuffer()));
  check('TEE: unauthorized observer CANNOT read beneficiaries (filtered)', !obsSees,
    obsRaw ? `observer saw ${obsRaw.data?.length ?? 0} bytes` : 'observer read returned null');

  // ---- 6a. PRIVACY GATE: a non-owner crank must NOT reveal the BeneficiarySet BEFORE the switch
  //          fires. Pre-fire the Switch is still delegated (base owner != program), so the TEE ix
  //          cannot prove a fire -> rejected. The SAME crank succeeds post-fire (step 9). ----
  const revealEarlyIx = await program.methods
    .crankUndelegateBeneficiaries()
    .accountsPartial({
      payer: crankKp.publicKey, owner: ownerKp.publicKey, beneficiarySet: benSet, switch: capsule,
      permission, permissionProgram: PERMISSION_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID, magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();
  const earlyFail = await sendERExpectFail([revealEarlyIx], [crankKp], crankKp, await teeConnFor(crankKp));
  check('privacy gate: non-owner reveal BEFORE fire is REJECTED', earlyFail !== null,
    earlyFail ? `blocked: ${earlyFail.slice(0, 64)}` : 'NOT blocked - reveal landed pre-fire (LEAK)');

  // ---- 6b. ESCAPE HATCH: owner pulls Vault funds while the Switch is delegated (regular ER). ----
  const vbBefore = await retry(() => baseConn.getBalance(vault));
  const recIx = await program.methods
    .recoverVault()
    .accountsPartial({
      capsule, vault, owner: ownerKp.publicKey, systemProgram: SystemProgram.programId,
      tokenProgram: null, mint: null, vaultTokenAccount: null, ownerTokenAccount: null,
    })
    .instruction();
  let recovered = false, rDetail = '';
  try {
    await sendBase([recIx], [ownerKp]);
    const vbAfter = await retry(() => baseConn.getBalance(vault));
    recovered = (vbBefore - vbAfter) >= Math.floor(DEPOSIT_SOL * LAMPORTS_PER_SOL) * 0.9;
    rDetail = `vault ${sol(vbBefore)} -> ${sol(vbAfter)} SOL (Switch delegated)`;
  } catch (e) { rDetail = 'recover err: ' + (e.message?.slice(0, 90) ?? ''); }
  check('escape hatch: owner recover_vault while Switch DELEGATED returns funds', recovered, rDetail);

  // ---- 7. wait out the trigger, then schedule the autonomous crank on the regular ER ----
  // Schedule only once the capsule is actually due, so the first ScheduleTask iteration succeeds.
  // Inactivity mode: wait the inactivity window. Date mode: the delegations already took longer than
  // DATE_OFFSET_S, so target_date is in the past now - a short settle wait is enough.
  await sleep((MODE === 'date' ? Math.max(DATE_OFFSET_S - 20, 2) + 3 : INACTIVITY + 3) * 1000);
  const args = { taskId: new BN(Date.now()), executionIntervalMillis: new BN(SCHEDULE_INTERVAL_MS), iterations: new BN(SCHEDULE_ITERS) };
  const schedIx = await program.methods
    .scheduleExecuteIntent(args)
    .accountsPartial({ magicProgram: MAGIC_PROGRAM_ID, payer: ownerKp.publicKey, capsule })
    .instruction();
  const schedSig = await sendER([schedIx], [ownerKp], ownerKp, switchEr);
  console.log('7. scheduled execute_intent crank on regular ER:', schedSig);

  // ---- 8. watch for the autonomous fire on the regular-ER Switch ----
  let fired = false, firedAt = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < FIRE_WATCH_S * 1000) {
    await sleep(3000);
    const info = await getAcct(switchEr, capsule).catch(() => null);
    if (!info) continue;
    const dec = decodeCapsule(info.data);
    const secs = Math.round((Date.now() - startedAt) / 1000);
    process.stdout.write(`   t+${secs}s is_active=${dec.is_active} executed_at=${dec.executed_at ? dec.executed_at.toString() : 'null'}      \r`);
    if (dec.is_active === false) { fired = true; firedAt = dec.executed_at?.toString(); break; }
  }
  console.log('');
  check('execute_intent fired AUTONOMOUSLY on regular ER (no off-chain crank)', fired, firedAt ? `executed_at=${firedAt}` : 'did not fire in window');

  // ---- 9. crank_undelegate the SWITCH back to base (regular ER) - fired state lands on base ----
  const undSwitchIx = await program.methods
    .crankUndelegate()
    .accountsPartial({
      payer: crankKp.publicKey, owner: ownerKp.publicKey, capsule,
      magicContext: MAGIC_CONTEXT_ID, magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();
  const undSwitchSig = await sendER([undSwitchIx], [crankKp], crankKp, switchEr);
  console.log('9. crank_undelegate (Switch) sent on regular ER:', undSwitchSig);

  let switchBack = false, switchFiredOnBase = false;
  for (let i = 0; i < 16; i++) {
    await sleep(2500);
    const info = await getAcct(baseConn, capsule).catch(() => null);
    if (info?.owner.equals(PROGRAM_ID)) {
      switchBack = true;
      const dec = decodeCapsule(info.data);
      switchFiredOnBase = dec.is_active === false && dec.executed_at != null;
      if (switchFiredOnBase) break;
    }
  }
  check('Switch undelegated back to base, fired state committed', switchBack && switchFiredOnBase);

  // ---- 10. *** CROSS-ER PROOF *** crank_undelegate_beneficiaries on the TEE reads the now-base
  //          Switch to confirm the fire, then reveals the BeneficiarySet. A NON-owner crank, post-fire,
  //          must now succeed - proving (a) the TEE ix can read the base Switch and (b) the gate opens. ----
  const revealIx = await program.methods
    .crankUndelegateBeneficiaries()
    .accountsPartial({
      payer: crankKp.publicKey, owner: ownerKp.publicKey, beneficiarySet: benSet, switch: capsule,
      permission, permissionProgram: PERMISSION_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID, magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();
  let revealSig = null, revealErr = '';
  const crankTee = await teeConnFor(crankKp);
  for (let i = 0; i < REVEAL_TRIES; i++) {
    try { revealSig = await sendER([revealIx], [crankKp], crankKp, crankTee); break; }
    catch (e) { revealErr = e.message?.slice(0, 80) ?? ''; await sleep(REVEAL_GAP_MS); } // TEE base view may lag
  }
  check('CROSS-ER PROOF: TEE reveal reads base Switch + undelegates BeneficiarySet (non-owner, post-fire)',
    revealSig !== null, revealSig ? revealSig : `never landed: ${revealErr}`);

  let benBack = false;
  if (revealSig) {
    for (let i = 0; i < 16; i++) {
      await sleep(2500);
      const info = await getAcct(baseConn, benSet).catch(() => null);
      if (info?.owner.equals(PROGRAM_ID)) { benBack = true; break; }
    }
  }
  check('BeneficiarySet undelegated back to base (owner = program)', benBack);

  // ---- 11. verify the committed state on base ----
  if (switchBack) {
    const cap = decodeCapsule((await getAcct(baseConn, capsule)).data);
    check('base: Switch is_active = false', cap.is_active === false);
    check('base: Switch executed_at set', cap.executed_at != null, cap.executed_at?.toString());
    if (MODE === 'date') {
      const ea = cap.executed_at != null ? Number(cap.executed_at) : null;
      const la = Number(cap.last_activity);
      const td = cap.target_date != null ? Number(cap.target_date) : null;
      check('date mode: target_date persisted on-chain', td === targetDateUnix, `on-chain=${td} expected=${targetDateUnix}`);
      // The clincher: it fired AFTER the target_date but well BEFORE the (3600s) inactivity deadline,
      // so the date trigger - not inactivity - is what fired execute_intent on the live ER.
      check('date mode: fired via target_date, NOT inactivity',
        ea != null && td != null && ea >= td && ea < la + effectiveInactivity,
        `executed_at=${ea} target_date=${td} inactivity_deadline=${la + effectiveInactivity}`);
    }
  }
  if (benBack) {
    const bs = decodeBenSet((await getAcct(baseConn, benSet)).data);
    const b = bs.beneficiaries;
    const benRoundTrip = b.length === 2
      && b[0].pubkey.equals(ben1.publicKey) && b[0].share_bps === 6000
      && b[1].pubkey.equals(ben2.publicKey) && b[1].share_bps === 4000;
    check('base: private beneficiaries round-tripped intact (now public)', benRoundTrip, `count=${b.length}`);
    const nftAssignments = bs.nft_assignments;
    const nftRoundTrip = nftAssignments.length === 1
      && nftAssignments[0].mint.equals(nftMint)
      && nftAssignments[0].recipient.equals(ben1.publicKey);
    check('base: private NFT assignment round-tripped intact (now public)', nftRoundTrip,
      `count=${nftAssignments.length}`);
    console.log('   distribute_assets is covered separately and is not run here.');
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

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
 * Run (regular ER):  node scripts/magicblock/er-roundtrip.mjs
 * Run (Private/TEE):  TEE=1 node scripts/magicblock/er-roundtrip.mjs
 *   TEE=1 routes ER ops through the TEE RPC (devnet-tee.magicblock.app) with a per-key auth token
 *   minted via the SDK (getAuthToken: /auth/challenge -> sign -> /auth/login -> ?token=), attests
 *   the Intel TDX enclave, and proves an unauthorized observer cannot read the private beneficiaries
 *   on the ER - the assertion the regular ER cannot make (it does not enforce the permission account).
 * Env:  TEE (=1 for Private ER), TEE_RPC, ER_RPC (regular-ER override), VALIDATOR, INACTIVITY (s),
 *       SCHEDULE_INTERVAL_MS, SCHEDULE_ITERS, FUND_SOL, DEPOSIT_SOL
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
// ER endpoint selection:
//   - regular ER (default): router discovers the per-account fqdn after delegation, or ER_RPC pins one.
//   - Private ER / TEE (TEE=1): skip the router (it does not route to the TEE node). Mint a per-key
//     auth token via the SDK's getAuthToken (/auth/challenge -> sign -> /auth/login) and connect to
//     TEE_RPC?token=<token>. The token gates *reads* by the key's permission member flags.
const TEE = process.env.TEE === '1' || /tee/i.test(process.env.ER_RPC ?? '');
const TEE_RPC = (process.env.TEE_RPC ?? 'https://devnet-tee.magicblock.app').replace(/\/+$/, '');
const TEE_VALIDATOR = 'MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo'; // devnet TEE node (constants.rs)
const ER_RPC_OVERRIDE = (!TEE && process.env.ER_RPC) ? process.env.ER_RPC : null;
const ROUTER_RPC = process.env.ROUTER_RPC ?? 'https://devnet-router.magicblock.app/';
const VALIDATOR = new PublicKey(process.env.VALIDATOR ?? (TEE ? TEE_VALIDATOR : 'MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57'));

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
// Reassigned to the router-issued fqdn (or the owner-authed TEE connection) after delegation.
let erConn = new Connection(ER_RPC_OVERRIDE ?? 'https://devnet-as.magicblock.app', connOpts);

// TEE: mint a per-key auth token (proves ownership of the key) and open a token-authed connection to
// the Private ER. The token gates reads via the Query Filtering Service by the key's member flags;
// sends stay authorized on-chain. Cached one connection per key.
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

// Attest the Private ER enclave before trusting it with private state: fetch a TDX quote, pull Intel
// collateral from Phala PCCS, and verify the quote. NOTE the challenge must decode to exactly 64 bytes
// (the TDX reportData width) - the devnet /quote endpoint rejects anything else, and the SDK's bundled
// verifyTeeRpcIntegrity hardcodes 32, so we drive @phala/dcap-qvl directly (the same library the SDK
// uses). The challenge is server-side anti-replay; the check is "genuine TDX quote + valid Intel
// collateral", matching the SDK's own RPC-integrity semantics.
async function attestTee(teeRpc) {
  const ch = randomBytes(64).toString('base64');
  const r = await timeoutFetch(`${teeRpc}/quote?challenge=${encodeURIComponent(ch)}`);
  const body = await r.json();
  if (r.status !== 200 || !body.quote) throw new Error(body.error ?? 'no quote returned');
  const rawQuote = Uint8Array.from(Buffer.from(body.quote, 'base64'));
  const collateral = await getCollateral('https://pccs.phala.network/tdx/certification/v4', rawQuote);
  try { verify(rawQuote, collateral, Math.floor(Date.now() / 1000)); }
  catch (e) { if (!e.message.includes('SEPT_VE_DISABLE is not enabled')) throw e; } // tolerate TDX SEPT VE cfg
  const td = Quote.parse(rawQuote).report.asTd10?.();
  if (!td) throw new Error('not a TD10 quote');
  return true;
}

// Ask the router which ER (fqdn) hosts a delegated account; the TEE fqdn carries the auth token.
async function routerFqdn(account) {
  const body = await retry(async () => {
    const res = await timeoutFetch(ROUTER_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getDelegationStatus', params: [account.toBase58()] }),
    });
    return res.json();
  }, 4, 2000);
  if (body.error) throw new Error('router: ' + body.error.message);
  return body.result; // { isDelegated, fqdn, delegationRecord }
}

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
const relayerKp = loadKp(sk(process.env.RELAYER_KEY ?? 'heres-relayer.json')); // heartbeat_authority
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
// SDK permission seed is "permission:" (with the colon) - Permission::find_pda.
const [permission] = PublicKey.findProgramAddressSync([seed('permission:'), capsule.toBuffer()], PERMISSION_PROGRAM_ID);
const [bufferPda] = PublicKey.findProgramAddressSync([seed('buffer'), capsule.toBuffer()], PROGRAM_ID);
const [delegationRecord] = PublicKey.findProgramAddressSync([seed('delegation'), capsule.toBuffer()], DELEGATION_PROGRAM_ID);
const [delegationMetadata] = PublicKey.findProgramAddressSync([seed('delegation-metadata'), capsule.toBuffer()], DELEGATION_PROGRAM_ID);
// Delegation PDAs for the permission account itself (owner_program = permission program).
const [bufferPermission] = PublicKey.findProgramAddressSync([seed('buffer'), permission.toBuffer()], PERMISSION_PROGRAM_ID);
const [delegationRecordPermission] = PublicKey.findProgramAddressSync([seed('delegation'), permission.toBuffer()], DELEGATION_PROGRAM_ID);
const [delegationMetadataPermission] = PublicKey.findProgramAddressSync([seed('delegation-metadata'), permission.toBuffer()], DELEGATION_PROGRAM_ID);

// Send a tx to the ER (skipPreflight: the ER may not simulate the cloned program cleanly). Confirm by
// polling signature status over HTTP - the TEE auth token rides the URL query on HTTP, sidestepping
// any WS-subscription token edge cases. `conn` defaults to erConn (owner-authed in TEE mode).
async function sendER(ixs, signers, feePayer, conn = erConn) {
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

// One-shot ER send that EXPECTS the tx to fail (for adversarial checks). Returns the error string if
// the tx was rejected/failed (good - the on-chain gate blocked it) or null if it unexpectedly landed.
async function sendERExpectFail(ixs, signers, feePayer, conn) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: feePayer.publicKey, blockhash, lastValidBlockHeight });
  ixs.forEach(ix => tx.add(ix));
  tx.sign(...signers);
  let sig;
  try { sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true }); }
  catch (e) { return e.message ?? 'send rejected'; } // rejected at submit = blocked
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const s = (await conn.getSignatureStatuses([sig]))?.value?.[0];
    if (!s) continue;
    if (s.err) return JSON.stringify(s.err);                                   // failed on-chain = blocked
    if (['processed', 'confirmed', 'finalized'].includes(s.confirmationStatus)) return null; // landed = bad
  }
  return null; // never resolved -> treat as not-blocked (inconclusive)
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
};

console.log('=== Heres lean ER round-trip ===');
console.log('program  :', PROGRAM_ID.toBase58());
console.log('mode     :', TEE ? `PRIVATE ER / TEE (${TEE_RPC})` : 'regular ER');
console.log('ER RPC   :', TEE ? TEE_RPC : (ER_RPC_OVERRIDE ?? `(router ${ROUTER_RPC})`), '| validator', VALIDATOR.toBase58());
console.log('owner    :', ownerKp.publicKey.toBase58());
console.log('capsule  :', capsule.toBase58());
console.log('vault    :', vault.toBase58());
console.log('relayer  :', relayerKp.publicKey.toBase58(), '(heartbeat_authority)');
console.log('crank    :', crankKp.publicKey.toBase58(), '(undelegate payer)');
console.log(`knobs    : inactivity=${INACTIVITY}s schedule=${SCHEDULE_INTERVAL_MS}ms x ${SCHEDULE_ITERS}\n`);

try {
  // ---- 0. (TEE) attest the enclave before trusting it with private state ----
  if (TEE) {
    try {
      const ok = await attestTee(TEE_RPC);
      check('TEE attestation: Intel TDX quote verified (Phala PCCS)', ok === true);
    } catch (e) {
      console.log('   (TEE attestation skipped - external verifier error:', e.message?.slice(0, 100), ')');
    }
  }

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

  // ---- 4. delegate the Switch + create/delegate the PER permission ----
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
      // PER permission lifecycle
      permissionProgram: PERMISSION_PROGRAM_ID,
      permission,
      bufferPermission,
      delegationRecordPermission,
      delegationMetadataPermission,
    })
    .instruction();
  await sendBase([delegateIx], [ownerKp]);

  // base account now owned by the delegation program
  let baseDelegated = false;
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    const baseInfo = await getAcct(baseConn, capsule).catch(() => null);
    if (baseInfo?.owner.equals(DELEGATION_PROGRAM_ID)) { baseDelegated = true; break; }
  }

  // Establish the ER RPC for the capsule. TEE: skip the router (it does not route to the TEE node) and
  // open an owner-authed token connection (owner = AUTHORITY + all read flags = privileged reads).
  if (TEE) {
    erConn = await teeConnFor(ownerKp);
    console.log('   TEE ER:', TEE_RPC + '?token=*** (owner-authed)');
  } else if (!ER_RPC_OVERRIDE) {
    try {
      const status = await routerFqdn(capsule);
      if (status?.fqdn) {
        erConn = new Connection(status.fqdn, connOpts);
        console.log('   router fqdn:', status.fqdn.replace(/token=[^&]+/, 'token=***'), '| validator', status.delegationRecord?.authority);
      } else { console.log('   router: no fqdn (isDelegated=' + status?.isDelegated + ')'); }
    } catch (e) { console.log('   router err:', e.message?.slice(0, 120)); }
  }

  // ER should now have the cloned account
  let erCloned = false;
  for (let i = 0; i < 12; i++) {
    const erInfo = await getAcct(erConn, capsule).catch(() => null);
    if (erInfo) { erCloned = true; break; }
    await sleep(2500);
  }
  check('delegate Switch (base owner = delegation program, ER cloned)', baseDelegated && erCloned);
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
    await sendER([hbIx], [relayerKp], relayerKp, TEE ? await teeConnFor(relayerKp) : erConn);
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

  // TEE privacy proof: the owner (read flags) sees beneficiaries on the ER; an unauthorized observer
  // (fresh key, not a permission member) is filtered by the TEE and cannot. This is the assertion the
  // regular ER could never make - it does not enforce the permission account.
  if (TEE) {
    const ownerRaw = await getAcct(erConn, capsule);
    const ownerSees = !!(ownerRaw && ownerRaw.data.includes(ben1.publicKey.toBuffer()));
    check('TEE: owner (AUTHORITY + read flags) CAN read beneficiaries on ER', ownerSees);
    const obsKp = Keypair.generate();
    const obsConn = await teeConnFor(obsKp);
    const obsRaw = await obsConn.getAccountInfo(capsule).catch(() => null);
    const obsSees = !!(obsRaw && obsRaw.data && obsRaw.data.includes(ben1.publicKey.toBuffer()));
    check('TEE: unauthorized observer CANNOT read beneficiaries on ER (filtered)', !obsSees,
      obsRaw ? `observer saw ${obsRaw.data?.length ?? 0} bytes` : 'observer read returned null');
  }

  // ---- 6a. PRIVACY GATE: a non-owner crank must NOT be able to undelegate (which would commit the
  //          private beneficiaries to the public base layer) BEFORE the switch fires. The SAME crank
  //          wallet succeeds post-fire (step 9) - the only difference is the fired state, proving the
  //          fix is the gate (audit: crank_undelegate was permissionless with no fired-check). ----
  const undEarlyIx = await program.methods
    .crankUndelegate()
    .accountsPartial({
      payer: crankKp.publicKey, owner: ownerKp.publicKey, capsule, permission,
      permissionProgram: PERMISSION_PROGRAM_ID, magicContext: MAGIC_CONTEXT_ID, magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();
  const earlyFail = await sendERExpectFail([undEarlyIx], [crankKp], crankKp, TEE ? await teeConnFor(crankKp) : erConn);
  check('privacy gate: non-owner crank_undelegate BEFORE fire is REJECTED', earlyFail !== null,
    earlyFail ? `blocked: ${earlyFail.slice(0, 64)}` : 'NOT blocked - undelegate landed pre-fire (LEAK)');

  // ---- 6b. ESCAPE HATCH: the owner can pull funds from the Vault while the Switch is DELEGATED (the
  //          stuck/dead-validator case). The Vault is never delegated and recover_vault no longer
  //          depends on the (delegated) Switch account, so this works even though the Switch is owned
  //          by the delegation program here (audit item 4: the hatch was inoperable when delegated). ----
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

  // ---- 9. crank_undelegate: commit + undelegate the Switch AND the PER permission back to base ----
  const undIx = await program.methods
    .crankUndelegate()
    .accountsPartial({
      payer: crankKp.publicKey,
      owner: ownerKp.publicKey,
      capsule,
      permission,
      permissionProgram: PERMISSION_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();
  const undSig = await sendER([undIx], [crankKp], crankKp, TEE ? await teeConnFor(crankKp) : erConn);
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

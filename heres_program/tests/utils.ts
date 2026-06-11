// Shared test helpers for the Heres lean program (bankrun harness).
//
// Bankrun runs the exact compiled .so in a local SVM with a controllable Clock, which is what makes
// the time-gated logic (inactivity firing + the 48h grace window) testable in milliseconds instead
// of real time. The program is loaded NON-upgradeable here (no ProgramData), so init_fee_config's
// C3 gate is not exercisable in bankrun - we pre-seed the fee_config account instead and cover
// init_fee_config on devnet. The 3 ER instructions (delegate/crank/schedule) CPI into MagicBlock
// programs absent from the local SVM and are covered separately on devnet.

import { start, Clock, ProgramTestContext, BanksClient } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  AccountLayout,
} from "@solana/spl-token";
import { expect } from "chai";
import idl from "../target/idl/heres_program.json";

export { BN, PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL, TOKEN_PROGRAM_ID };

// ---- canonical constants (must mirror programs/heres_program/src/constants.rs) ----
export const PROGRAM_ID = new PublicKey((idl as any).address);
export const PERMISSION_PROGRAM_ID = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
);
export const GRACE_PERIOD = 48 * 60 * 60; // constants.rs GRACE_PERIOD
export const MAX_CREATION_FEE_LAMPORTS = 1_000_000_000; // constants.rs MAX_CREATION_FEE_LAMPORTS
export const MAX_BENEFICIARIES = 8;
export const BPS_DENOMINATOR = 10_000;

// rent-exempt minimums under default rent (deterministic; bankrun uses default rent)
const MINT_RENT = 1_461_600;

// ---- PDA derivations (seeds mirror the program) ----
export const feeConfigPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("fee_config")], PROGRAM_ID)[0];
export const capsulePda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("intent_capsule"), owner.toBuffer()],
    PROGRAM_ID
  )[0];
export const vaultPda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("capsule_vault"), owner.toBuffer()],
    PROGRAM_ID
  )[0];
export const permissionPda = (capsule: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("permission"), capsule.toBuffer()],
    PERMISSION_PROGRAM_ID
  )[0];
export const ataFor = (owner: PublicKey, mint: PublicKey, offCurve = false) =>
  getAssociatedTokenAddressSync(mint, owner, offCurve);

export interface Env {
  context: ProgramTestContext;
  client: BanksClient;
  provider: BankrunProvider;
  program: Program;
  payer: Keypair;
  feeAuthority: Keypair;
  feeRecipient: PublicKey;
  creationFee: number;
}

// Build a fresh SVM with the fee_config singleton pre-seeded (since init_fee_config's C3 gate needs
// an upgradeable ProgramData that bankrun does not provide - that path is covered on devnet).
export async function startEnv(opts?: {
  creationFee?: number;
  feeRecipient?: PublicKey;
}): Promise<Env> {
  const feeAuthority = Keypair.generate();
  const creationFee = opts?.creationFee ?? 0;
  const feeRecipient = opts?.feeRecipient ?? Keypair.generate().publicKey;

  // Seed the FeeConfig account by hand: discriminator(8) + authority(32) + fee_recipient(32) +
  // creation_fee_lamports(u64 LE). Manual layout sidesteps the Anchor TS coder's snake/camel field
  // asymmetry (its encode ignores camelCase keys for this snake_case IDL, zeroing fields).
  const feeDisc = Buffer.from(
    (idl as any).accounts.find((a: any) => a.name === "FeeConfig").discriminator
  );
  const feeData = Buffer.concat([
    feeDisc,
    feeAuthority.publicKey.toBuffer(),
    feeRecipient.toBuffer(),
    new BN(creationFee).toArrayLike(Buffer, "le", 8),
  ]);

  const context = await start(
    [{ name: "heres_program", programId: PROGRAM_ID }],
    [
      {
        address: feeConfigPda(),
        info: {
          lamports: LAMPORTS_PER_SOL,
          data: feeData,
          owner: PROGRAM_ID,
          executable: false,
        },
      },
    ]
  );
  const provider = new BankrunProvider(context);
  const program = new Program(idl as any, provider);
  return {
    context,
    client: context.banksClient,
    provider,
    program,
    payer: context.payer,
    feeAuthority,
    feeRecipient,
    creationFee,
  };
}

// ---- clock control ----
export async function getNow(env: Env): Promise<number> {
  const clock = await env.client.getClock();
  return Number(clock.unixTimestamp);
}

export async function setNow(env: Env, unixTs: number): Promise<void> {
  const c = await env.client.getClock();
  env.context.setClock(
    new Clock(
      c.slot,
      c.epochStartTimestamp,
      c.epoch,
      c.leaderScheduleEpoch,
      BigInt(Math.floor(unixTs))
    )
  );
}

export async function warp(env: Env, seconds: number): Promise<void> {
  const now = await getNow(env);
  await setNow(env, now + seconds);
}

// ---- transaction plumbing ----
async function blockhash(env: Env): Promise<string> {
  const r = await env.client.getLatestBlockhash();
  return r ? r[0] : env.context.lastBlockhash;
}

function dedupeSigners(signers: Keypair[]): Keypair[] {
  const seen = new Map<string, Keypair>();
  for (const s of signers) seen.set(s.publicKey.toBase58(), s);
  return [...seen.values()];
}

// Send one or more raw instructions; returns the bankrun result (does NOT throw on program error).
export async function sendRaw(
  env: Env,
  feePayer: Keypair,
  ixs: TransactionInstruction[],
  signers: Keypair[] = []
) {
  const tx = new Transaction().add(...ixs);
  tx.recentBlockhash = await blockhash(env);
  tx.feePayer = feePayer.publicKey;
  tx.sign(...dedupeSigners([feePayer, ...signers]));
  return env.client.tryProcessTransaction(tx);
}

// Build an Anchor instruction from a method-builder and send it.
export async function send(
  env: Env,
  feePayer: Keypair,
  methodBuilder: any,
  signers: Keypair[] = []
) {
  const ix: TransactionInstruction = await methodBuilder.instruction();
  return sendRaw(env, feePayer, [ix], signers);
}

// ---- assertions ----
function logsOf(res: any): string {
  return (res?.meta?.logMessages ?? []).join("\n");
}

export function assertOk(res: any, label = "tx") {
  if (res?.result) {
    throw new Error(`${label} unexpectedly failed: ${res.result}\n${logsOf(res)}`);
  }
}

// Assert the tx failed AND its logs name the expected Anchor error code (e.g. "InvalidShareSum").
export function assertErr(res: any, errName: string) {
  expect(res?.result, `expected tx to fail with ${errName}, but it succeeded`).to.not.be.null;
  const logs = logsOf(res);
  expect(
    logs.includes(errName),
    `expected error "${errName}" in logs but got:\n${logs}`
  ).to.eq(true);
}

// Assert the tx failed for any reason (used where the failure is a runtime/seeds error without a
// clean named code in logs, e.g. account-already-in-use, seeds mismatch).
export function assertFailed(res: any, label = "tx") {
  expect(res?.result, `expected ${label} to fail, but it succeeded`).to.not.be.null;
}

// ---- account reads ----
export async function fetchCapsule(env: Env, owner: PublicKey): Promise<any | null> {
  const acct = await env.client.getAccount(capsulePda(owner));
  if (!acct) return null;
  return decode(env, "IntentCapsule", Buffer.from(acct.data));
}

export async function fetchFeeConfig(env: Env): Promise<any | null> {
  const acct = await env.client.getAccount(feeConfigPda());
  if (!acct) return null;
  return decode(env, "FeeConfig", Buffer.from(acct.data));
}

function decode(env: Env, name: string, data: Buffer): any {
  try {
    return env.program.coder.accounts.decode(name, data);
  } catch {
    const alt = name[0].toLowerCase() + name.slice(1);
    return env.program.coder.accounts.decode(alt, data);
  }
}

export async function lamportsOf(env: Env, pubkey: PublicKey): Promise<number> {
  return Number(await env.client.getBalance(pubkey));
}

export async function tokenBalance(env: Env, ata: PublicKey): Promise<bigint> {
  const acct = await env.client.getAccount(ata);
  if (!acct) return 0n;
  return AccountLayout.decode(Buffer.from(acct.data)).amount;
}

export async function accountExists(env: Env, pubkey: PublicKey): Promise<boolean> {
  const acct = await env.client.getAccount(pubkey);
  return !!acct && acct.lamports > 0;
}

// ---- funded keypair ----
export async function fundedKeypair(env: Env, sol = 50): Promise<Keypair> {
  const kp = Keypair.generate();
  const ix = SystemProgram.transfer({
    fromPubkey: env.payer.publicKey,
    toPubkey: kp.publicKey,
    lamports: sol * LAMPORTS_PER_SOL,
  });
  const res = await sendRaw(env, env.payer, [ix]);
  assertOk(res, "fund keypair");
  return kp;
}

// ---- SPL helpers (built manually since bankrun has no RPC Connection) ----
export async function createMint(
  env: Env,
  authority: PublicKey,
  decimals = 6
): Promise<PublicKey> {
  const mint = Keypair.generate();
  const ixs = [
    SystemProgram.createAccount({
      fromPubkey: env.payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports: MINT_RENT,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, decimals, authority, null),
  ];
  const res = await sendRaw(env, env.payer, ixs, [mint]);
  assertOk(res, "createMint");
  return mint.publicKey;
}

export async function createAta(
  env: Env,
  owner: PublicKey,
  mint: PublicKey,
  offCurve = false
): Promise<PublicKey> {
  const ata = ataFor(owner, mint, offCurve);
  const ix = createAssociatedTokenAccountInstruction(
    env.payer.publicKey,
    ata,
    owner,
    mint
  );
  const res = await sendRaw(env, env.payer, [ix]);
  assertOk(res, "createAta");
  return ata;
}

export async function mintTo(
  env: Env,
  mint: PublicKey,
  dest: PublicKey,
  authority: Keypair,
  amount: bigint | number
): Promise<void> {
  const ix = createMintToInstruction(mint, dest, authority.publicKey, BigInt(amount));
  const res = await sendRaw(env, env.payer, [ix], [authority]);
  assertOk(res, "mintTo");
}

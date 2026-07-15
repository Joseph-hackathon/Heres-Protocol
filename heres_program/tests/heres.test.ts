// Heres lean program - structured bankrun test suite.
//
// Coverage (15 base-layer instructions + edge cases):
//   fee config .......... update_fee_config (authority gate, fee cap)
//   lifecycle ........... create_capsule, deposit (SOL+SPL/NFT), update_intent,
//                        update_nft_assignments, cancel, finalize
//   firing .............. execute_intent (inactivity gate), update_activity (active-only bump)
//   distribution ........ distribute_assets (SOL+SPL) + distribute_nft (explicit recipient)
//   escape hatch ........ recover_vault (SOL+SPL, pre-fire only)
//
// init_fee_config (C3 upgrade-authority gate) and the ER instructions (delegate_capsule,
// delegate_beneficiaries, crank_undelegate, crank_undelegate_beneficiaries, schedule_execute_intent)
// are covered on devnet (scripts/magicblock/er-roundtrip.mjs) - bankrun loads the program
// non-upgradeable and has no MagicBlock programs. See scripts/init-fee-config.ts and tests/README.md.
//
// Workstream A note: the private beneficiary list lives in its own BeneficiarySet account (delegated
// to the TEE in production). Bankrun never delegates, so update_intent / distribute / cancel /
// finalize exercise it directly on the base layer here.

// Each on-chain Beneficiary carries a reserved[14] pad (future cross-chain heir field); the TS arg
// must include it or Anchor's coder rejects the encode.
const withReserved = (
  list: { pubkey: PublicKey; shareBps: number }[]
) => list.map((b) => ({ ...b, reserved: Array(14).fill(0) }));

import { assert, expect } from "chai";
import { createHash } from "node:crypto";
import { SystemProgram as SP } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Env,
  startEnv,
  BN,
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TOKEN_PROGRAM_ID,
  MAX_CREATION_FEE_LAMPORTS,
  capsulePda,
  vaultPda,
  beneficiarySetPda,
  feeConfigPda,
  ataFor,
  send,
  sendRaw,
  assertOk,
  assertErr,
  assertFailed,
  fetchCapsule,
  fetchBeneficiarySet,
  fetchFeeConfig,
  lamportsOf,
  tokenBalance,
  accountExists,
  fundedKeypair,
  createMint,
  createAta,
  mintTo,
  getNow,
  setNow,
  warp,
} from "./utils";

// ----- instruction builders (camelCase JS API over the snake_case IDL) -----
const createCapsuleIx = (
  env: Env,
  owner: Keypair,
  inactivity: number,
  heartbeat: PublicKey,
  feeRecipient: PublicKey | null = null,
  targetDate: BN | null = null
) =>
  env.program.methods
    .createCapsule(new BN(inactivity), heartbeat, targetDate)
    .accountsPartial({
      capsule: capsulePda(owner.publicKey),
      beneficiarySet: beneficiarySetPda(owner.publicKey),
      vault: vaultPda(owner.publicKey),
      owner: owner.publicKey,
      feeConfig: feeConfigPda(),
      platformFeeRecipient: feeRecipient,
      systemProgram: SystemProgram.programId,
    });

const updateIntentIx = (
  env: Env,
  owner: Keypair,
  beneficiaries: { pubkey: PublicKey; shareBps: number }[]
) =>
  env.program.methods.updateIntent(withReserved(beneficiaries)).accountsPartial({
    beneficiarySet: beneficiarySetPda(owner.publicKey),
    owner: owner.publicKey,
  });

const updateNftAssignmentsIx = (
  env: Env,
  owner: Keypair,
  assignments: { mint: PublicKey; recipient: PublicKey }[]
) =>
  env.program.methods.updateNftAssignments(assignments).accountsPartial({
    beneficiarySet: beneficiarySetPda(owner.publicKey),
    owner: owner.publicKey,
  });

const depositSolIx = (env: Env, owner: Keypair, amount: number) =>
  env.program.methods.deposit(new BN(amount)).accountsPartial({
    capsule: capsulePda(owner.publicKey),
    vault: vaultPda(owner.publicKey),
    owner: owner.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: null,
    associatedTokenProgram: null,
    mint: null,
    sourceTokenAccount: null,
    vaultTokenAccount: null,
  });

const depositSplIx = (
  env: Env,
  owner: Keypair,
  amount: number | bigint,
  mint: PublicKey,
  sourceAta: PublicKey
) =>
  env.program.methods.deposit(new BN(amount.toString())).accountsPartial({
    capsule: capsulePda(owner.publicKey),
    vault: vaultPda(owner.publicKey),
    owner: owner.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    mint,
    sourceTokenAccount: sourceAta,
    vaultTokenAccount: ataFor(vaultPda(owner.publicKey), mint, true),
  });

const executeIntentIx = (env: Env, ownerPk: PublicKey) =>
  env.program.methods.executeIntent().accountsPartial({
    capsule: capsulePda(ownerPk),
  });

const updateActivityIx = (env: Env, ownerPk: PublicKey, authority: PublicKey) =>
  env.program.methods.updateActivity().accountsPartial({
    capsule: capsulePda(ownerPk),
    authority,
  });

const distributeSolIx = (
  env: Env,
  ownerPk: PublicKey,
  recipients: PublicKey[]
) =>
  env.program.methods
    .distributeAssets()
    .accountsPartial({
      capsule: capsulePda(ownerPk),
      beneficiarySet: beneficiarySetPda(ownerPk),
      vault: vaultPda(ownerPk),
      systemProgram: SystemProgram.programId,
      tokenProgram: null,
      mint: null,
      vaultTokenAccount: null,
    })
    .remainingAccounts(
      recipients.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false }))
    );

const distributeSplIx = (
  env: Env,
  ownerPk: PublicKey,
  mint: PublicKey,
  recipientAtas: PublicKey[]
) =>
  env.program.methods
    .distributeAssets()
    .accountsPartial({
      capsule: capsulePda(ownerPk),
      beneficiarySet: beneficiarySetPda(ownerPk),
      vault: vaultPda(ownerPk),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      mint,
      vaultTokenAccount: ataFor(vaultPda(ownerPk), mint, true),
    })
    .remainingAccounts(
      recipientAtas.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false }))
    );

const distributeNftIx = (
  env: Env,
  ownerPk: PublicKey,
  mint: PublicKey,
  recipient: PublicKey,
  recipientAta: PublicKey
) =>
  env.program.methods.distributeNft(recipient).accountsPartial({
    capsule: capsulePda(ownerPk),
    beneficiarySet: beneficiarySetPda(ownerPk),
    vault: vaultPda(ownerPk),
    tokenProgram: TOKEN_PROGRAM_ID,
    mint,
    vaultTokenAccount: ataFor(vaultPda(ownerPk), mint, true),
    recipientTokenAccount: recipientAta,
  });

const recoverSolIx = (env: Env, owner: Keypair) =>
  env.program.methods.recoverVault().accountsPartial({
    capsule: capsulePda(owner.publicKey),
    vault: vaultPda(owner.publicKey),
    owner: owner.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: null,
    mint: null,
    vaultTokenAccount: null,
    ownerTokenAccount: null,
  });

const recoverSplIx = (env: Env, owner: Keypair, mint: PublicKey) =>
  env.program.methods.recoverVault().accountsPartial({
    capsule: capsulePda(owner.publicKey),
    vault: vaultPda(owner.publicKey),
    owner: owner.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    mint,
    vaultTokenAccount: ataFor(vaultPda(owner.publicKey), mint, true),
    ownerTokenAccount: ataFor(owner.publicKey, mint),
  });

const cancelSolIx = (env: Env, owner: Keypair) =>
  env.program.methods.cancelCapsule().accountsPartial({
    capsule: capsulePda(owner.publicKey),
    beneficiarySet: beneficiarySetPda(owner.publicKey),
    vault: vaultPda(owner.publicKey),
    owner: owner.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: null,
    mint: null,
    vaultTokenAccount: null,
    ownerTokenAccount: null,
  });

const cancelSplIx = (env: Env, owner: Keypair, mint: PublicKey) =>
  env.program.methods.cancelCapsule().accountsPartial({
    capsule: capsulePda(owner.publicKey),
    beneficiarySet: beneficiarySetPda(owner.publicKey),
    vault: vaultPda(owner.publicKey),
    owner: owner.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    mint,
    vaultTokenAccount: ataFor(vaultPda(owner.publicKey), mint, true),
    ownerTokenAccount: ataFor(owner.publicKey, mint),
  });

const finalizeIx = (
  env: Env,
  ownerPk: PublicKey,
  authority: PublicKey,
  feeRecipient = env.feeRecipient
) =>
  env.program.methods.finalizeCapsule().accountsPartial({
    capsule: capsulePda(ownerPk),
    beneficiarySet: beneficiarySetPda(ownerPk),
    vault: vaultPda(ownerPk),
    authority,
    feeConfig: feeConfigPda(),
    feeRecipient,
  });

const TEST_CONFIG_SALT = Array(32).fill(7);

function inheritanceCommitment(
  owner: PublicKey,
  beneficiaries: { pubkey: PublicKey; shareBps: number }[],
  nftAssignments: { mint: PublicKey; recipient: PublicKey }[],
  salt = TEST_CONFIG_SALT
): number[] {
  const u16 = (value: number) => {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(value);
    return bytes;
  };
  const u32 = (value: number) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value);
    return bytes;
  };
  const parts = [
    Buffer.from("heres:inheritance-config:v1"),
    Buffer.from(owner.toBytes()),
    u32(beneficiaries.length),
  ];
  for (const beneficiary of beneficiaries) {
    parts.push(Buffer.from(beneficiary.pubkey.toBytes()), u16(beneficiary.shareBps));
  }
  parts.push(u32(nftAssignments.length));
  for (const assignment of nftAssignments) {
    parts.push(Buffer.from(assignment.mint.toBytes()), Buffer.from(assignment.recipient.toBytes()));
  }
  parts.push(Buffer.from(salt));
  return Array.from(createHash("sha256").update(Buffer.concat(parts)).digest());
}

const sealInheritanceIx = (
  env: Env,
  owner: Keypair,
  beneficiaries: { pubkey: PublicKey; shareBps: number }[],
  nftAssignments: { mint: PublicKey; recipient: PublicKey }[],
  salt = TEST_CONFIG_SALT
) =>
  env.program.methods
    .sealInheritance(salt, inheritanceCommitment(owner.publicKey, beneficiaries, nftAssignments, salt))
    .accountsPartial({ beneficiarySet: beneficiarySetPda(owner.publicKey), owner: owner.publicKey });

const armCapsuleIx = (env: Env, owner: Keypair, commitment: number[]) =>
  env.program.methods.armCapsule(commitment).accountsPartial({
    capsule: capsulePda(owner.publicKey),
    owner: owner.publicKey,
  });

// ----- shared scenario helpers -----
const DAY = 24 * 60 * 60;

// Create an unarmed draft for a fresh funded owner; returns the owner keypair.
async function freshCapsule(
  env: Env,
  inactivity = DAY,
  heartbeat?: PublicKey
): Promise<Keypair> {
  const owner = await fundedKeypair(env, 50);
  const res = await send(
    env,
    owner,
    createCapsuleIx(env, owner, inactivity, heartbeat ?? owner.publicKey),
    [owner]
  );
  assertOk(res, "create_capsule");
  return owner;
}

async function sealAndArm(env: Env, owner: Keypair) {
  const cap = await fetchCapsule(env, owner.publicKey);
  if (cap.isActive) return;
  if (cap.executedAt != null) throw new Error("cannot arm an executed capsule");

  let set = await fetchBeneficiarySet(env, owner.publicKey);
  if (set.beneficiaries.length === 0) {
    const fallback = [{ pubkey: owner.publicKey, shareBps: 10000 }];
    assertOk(await send(env, owner, updateIntentIx(env, owner, fallback), [owner]));
    set = await fetchBeneficiarySet(env, owner.publicKey);
  }
  const beneficiaries = set.beneficiaries.map((beneficiary: any) => ({
    pubkey: beneficiary.pubkey,
    shareBps: beneficiary.shareBps,
  }));
  const nftAssignments = set.nftAssignments.map((assignment: any) => ({
    mint: assignment.mint,
    recipient: assignment.recipient,
  }));
  const commitment = inheritanceCommitment(owner.publicKey, beneficiaries, nftAssignments);
  assertOk(
    await send(env, owner, sealInheritanceIx(env, owner, beneficiaries, nftAssignments), [owner]),
    "seal_inheritance"
  );
  assertOk(await send(env, owner, armCapsuleIx(env, owner, commitment), [owner]), "arm_capsule");
}

// drive a capsule to the fired state (is_active=false, executed_at set)
async function fire(env: Env, owner: Keypair, inactivity: number) {
  await sealAndArm(env, owner);
  await warp(env, inactivity + 10);
  const res = await send(env, env.payer, executeIntentIx(env, owner.publicKey));
  assertOk(res, "execute_intent (fire)");
}

describe("heres: fee config", () => {
  it("authority updates the creation fee", async () => {
    const env = await startEnv({ creationFee: 0 });
    let cfg = await fetchFeeConfig(env);
    expect(cfg.creationFeeLamports.toNumber()).to.eq(0);

    const res = await send(
      env,
      env.payer,
      env.program.methods.updateFeeConfig(new BN(5_000_000)).accountsPartial({
        feeConfig: feeConfigPda(),
        authority: env.feeAuthority.publicKey,
      }),
      [env.feeAuthority]
    );
    assertOk(res, "update_fee_config");
    cfg = await fetchFeeConfig(env);
    expect(cfg.creationFeeLamports.toNumber()).to.eq(5_000_000);
  });

  it("rejects update from a non-authority", async () => {
    const env = await startEnv({ creationFee: 0 });
    const stranger = await fundedKeypair(env, 5);
    const res = await send(
      env,
      stranger,
      env.program.methods.updateFeeConfig(new BN(1_000_000)).accountsPartial({
        feeConfig: feeConfigPda(),
        authority: stranger.publicKey,
      }),
      [stranger]
    );
    assertErr(res, "Unauthorized");
  });

  it("rejects a fee above the 1 SOL cap", async () => {
    const env = await startEnv({ creationFee: 0 });
    const res = await send(
      env,
      env.payer,
      env.program.methods
        .updateFeeConfig(new BN(MAX_CREATION_FEE_LAMPORTS + 1))
        .accountsPartial({
          feeConfig: feeConfigPda(),
          authority: env.feeAuthority.publicKey,
        }),
      [env.feeAuthority]
    );
    assertErr(res, "InvalidFeeConfig");
  });
});

describe("heres: create_capsule", () => {
  it("creates a draft Switch + Vault with the expected state", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await fundedKeypair(env, 50);
    const heartbeat = Keypair.generate().publicKey;
    const res = await send(
      env,
      owner,
      createCapsuleIx(env, owner, DAY, heartbeat),
      [owner]
    );
    assertOk(res, "create_capsule");

    const cap = await fetchCapsule(env, owner.publicKey);
    expect(cap.owner.toBase58()).to.eq(owner.publicKey.toBase58());
    expect(cap.inactivityPeriod.toNumber()).to.eq(DAY);
    expect(cap.isActive).to.eq(false);
    expect(cap.executedAt).to.eq(null);
    expect(cap.heartbeatAuthority.toBase58()).to.eq(heartbeat.toBase58());
    expect(await accountExists(env, vaultPda(owner.publicKey))).to.eq(true);

    // the BeneficiarySet is created empty alongside the Switch
    const bs = await fetchBeneficiarySet(env, owner.publicKey);
    expect(bs.owner.toBase58()).to.eq(owner.publicKey.toBase58());
    expect(bs.beneficiaries.length).to.eq(0);
    expect(await accountExists(env, beneficiarySetPda(owner.publicKey))).to.eq(true);
  });

  it("rejects inactivity_period = 0", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await fundedKeypair(env, 50);
    const res = await send(
      env,
      owner,
      createCapsuleIx(env, owner, 0, owner.publicKey),
      [owner]
    );
    assertErr(res, "InvalidInactivityPeriod");
  });

  it("rejects a negative inactivity_period", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await fundedKeypair(env, 50);
    const res = await send(
      env,
      owner,
      env.program.methods
        .createCapsule(new BN(-1), owner.publicKey, null)
        .accountsPartial({
          capsule: capsulePda(owner.publicKey),
          beneficiarySet: beneficiarySetPda(owner.publicKey),
          vault: vaultPda(owner.publicKey),
          owner: owner.publicKey,
          feeConfig: feeConfigPda(),
          platformFeeRecipient: null,
          systemProgram: SystemProgram.programId,
        }),
      [owner]
    );
    assertErr(res, "InvalidInactivityPeriod");
  });

  it("allows only one capsule per owner", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const res = await send(
      env,
      owner,
      createCapsuleIx(env, owner, DAY, owner.publicKey),
      [owner]
    );
    assertFailed(res, "duplicate create");
  });
});

describe("heres: create_capsule fee path", () => {
  const FEE = 10_000_000; // 0.01 SOL

  it("charges the creation fee to the configured recipient", async () => {
    const recipient = Keypair.generate().publicKey;
    const env = await startEnv({ creationFee: FEE, feeRecipient: recipient });
    const owner = await fundedKeypair(env, 50);

    const before = await lamportsOf(env, recipient);
    const res = await send(
      env,
      owner,
      createCapsuleIx(env, owner, DAY, owner.publicKey, recipient),
      [owner]
    );
    assertOk(res, "create_capsule (fee)");
    const after = await lamportsOf(env, recipient);
    expect(after - before).to.eq(FEE);
  });

  it("rejects a wrong fee recipient", async () => {
    const recipient = Keypair.generate().publicKey;
    const env = await startEnv({ creationFee: FEE, feeRecipient: recipient });
    const owner = await fundedKeypair(env, 50);
    const wrong = Keypair.generate().publicKey;
    const res = await send(
      env,
      owner,
      createCapsuleIx(env, owner, DAY, owner.publicKey, wrong),
      [owner]
    );
    assertErr(res, "InvalidFeeConfig");
  });

  it("rejects a missing fee recipient when a fee is set", async () => {
    const recipient = Keypair.generate().publicKey;
    const env = await startEnv({ creationFee: FEE, feeRecipient: recipient });
    const owner = await fundedKeypair(env, 50);
    const res = await send(
      env,
      owner,
      createCapsuleIx(env, owner, DAY, owner.publicKey, null),
      [owner]
    );
    assertErr(res, "InvalidFeeConfig");
  });
});

describe("heres: deposit", () => {
  it("locks native SOL into the vault (repeatable)", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const vault = vaultPda(owner.publicKey);

    const base = await lamportsOf(env, vault);
    assertOk(await send(env, owner, depositSolIx(env, owner, 1 * LAMPORTS_PER_SOL), [owner]));
    expect((await lamportsOf(env, vault)) - base).to.eq(1 * LAMPORTS_PER_SOL);

    assertOk(await send(env, owner, depositSolIx(env, owner, 2 * LAMPORTS_PER_SOL), [owner]));
    expect((await lamportsOf(env, vault)) - base).to.eq(3 * LAMPORTS_PER_SOL);
  });

  it("locks SPL tokens into a vault ATA", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const mintAuth = await fundedKeypair(env, 5);
    const mint = await createMint(env, mintAuth.publicKey);
    const ownerAta = await createAta(env, owner.publicKey, mint);
    await mintTo(env, mint, ownerAta, mintAuth, 1_000_000n);

    assertOk(
      await send(env, owner, depositSplIx(env, owner, 750_000n, mint, ownerAta), [owner]),
      "deposit spl"
    );
    const vaultAta = ataFor(vaultPda(owner.publicKey), mint, true);
    expect(await tokenBalance(env, vaultAta)).to.eq(750_000n);
    expect(await tokenBalance(env, ownerAta)).to.eq(250_000n);
  });

  it("rejects a zero amount", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const res = await send(env, owner, depositSolIx(env, owner, 0), [owner]);
    assertErr(res, "InvalidAmount");
  });

  it("cannot deposit into another owner's vault", async () => {
    const env = await startEnv({ creationFee: 0 });
    const victim = await freshCapsule(env, DAY);
    const attacker = await fundedKeypair(env, 50);
    // attacker signs but points at the victim's capsule/vault PDAs
    const res = await send(
      env,
      attacker,
      env.program.methods.deposit(new BN(LAMPORTS_PER_SOL)).accountsPartial({
        capsule: capsulePda(victim.publicKey),
        vault: vaultPda(victim.publicKey),
        owner: attacker.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: null,
        associatedTokenProgram: null,
        mint: null,
        sourceTokenAccount: null,
        vaultTokenAccount: null,
      }),
      [attacker]
    );
    assertFailed(res, "cross-owner deposit");
  });

  it("rejects deposit after the switch has fired", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    await fire(env, owner, 100);
    const res = await send(env, owner, depositSolIx(env, owner, LAMPORTS_PER_SOL), [owner]);
    assertErr(res, "CapsuleInactive");
  });
});

describe("heres: update_intent", () => {
  const benes = (n: number, shares: number[]) =>
    Array.from({ length: n }, (_, i) => ({
      pubkey: Keypair.generate().publicKey,
      shareBps: shares[i],
    }));

  it("stores a valid beneficiary list summing to 10000", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const list = benes(2, [6000, 4000]);
    assertOk(await send(env, owner, updateIntentIx(env, owner, list), [owner]));

    const bs = await fetchBeneficiarySet(env, owner.publicKey);
    expect(bs.beneficiaries.length).to.eq(2);
    expect(bs.beneficiaries[0].shareBps).to.eq(6000);
    expect(bs.beneficiaries[1].shareBps).to.eq(4000);
    expect(bs.beneficiaries[0].pubkey.toBase58()).to.eq(list[0].pubkey.toBase58());
  });

  it("replaces an existing list", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    assertOk(await send(env, owner, updateIntentIx(env, owner, benes(2, [5000, 5000])), [owner]));
    const next = benes(3, [3000, 3000, 4000]);
    assertOk(await send(env, owner, updateIntentIx(env, owner, next), [owner]));
    const bs = await fetchBeneficiarySet(env, owner.publicKey);
    expect(bs.beneficiaries.length).to.eq(3);
  });

  it("rejects an empty list", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const res = await send(env, owner, updateIntentIx(env, owner, []), [owner]);
    assertErr(res, "NoBeneficiaries");
  });

  it("rejects shares that do not sum to 10000", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const res = await send(env, owner, updateIntentIx(env, owner, benes(2, [5000, 4000])), [owner]);
    assertErr(res, "InvalidShareSum");
  });

  it("rejects shares that sum above 10000", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const res = await send(env, owner, updateIntentIx(env, owner, benes(2, [6000, 5000])), [owner]);
    assertErr(res, "InvalidShareSum");
  });

  it("rejects more than 8 beneficiaries", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const nine = Array.from({ length: 9 }, () => ({
      pubkey: Keypair.generate().publicKey,
      shareBps: 1000,
    }));
    const res = await send(env, owner, updateIntentIx(env, owner, nine), [owner]);
    assertErr(res, "TooManyBeneficiaries");
  });

  it("rejects a default (zero) pubkey beneficiary", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const list = [
      { pubkey: PublicKey.default, shareBps: 5000 },
      { pubkey: Keypair.generate().publicKey, shareBps: 5000 },
    ];
    const res = await send(env, owner, updateIntentIx(env, owner, list), [owner]);
    assertErr(res, "InvalidBeneficiaryAddress");
  });

  it("rejects update from a non-owner", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const stranger = await fundedKeypair(env, 5);
    const res = await send(
      env,
      stranger,
      env.program.methods.updateIntent(withReserved(benes(1, [10000]))).accountsPartial({
        beneficiarySet: beneficiarySetPda(owner.publicKey),
        owner: stranger.publicKey,
      }),
      [stranger]
    );
    assertFailed(res, "non-owner update_intent");
  });
});

describe("heres: update_nft_assignments", () => {
  it("stores private mint-to-recipient assignments", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const assignments = [
      { mint: Keypair.generate().publicKey, recipient: Keypair.generate().publicKey },
      { mint: Keypair.generate().publicKey, recipient: Keypair.generate().publicKey },
    ];

    assertOk(await send(env, owner, updateNftAssignmentsIx(env, owner, assignments), [owner]));
    const bs = await fetchBeneficiarySet(env, owner.publicKey);
    expect(bs.nftAssignments.length).to.eq(2);
    expect(bs.nftAssignments[0].mint.toBase58()).to.eq(assignments[0].mint.toBase58());
    expect(bs.nftAssignments[0].recipient.toBase58()).to.eq(assignments[0].recipient.toBase58());
  });

  it("rejects duplicate mint assignments", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const mint = Keypair.generate().publicKey;
    const res = await send(
      env,
      owner,
      updateNftAssignmentsIx(env, owner, [
        { mint, recipient: Keypair.generate().publicKey },
        { mint, recipient: Keypair.generate().publicKey },
      ]),
      [owner]
    );
    assertErr(res, "DuplicateNftAssignment");
  });

  it("rejects more than 8 NFT assignments", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const nine = Array.from({ length: 9 }, () => ({
      mint: Keypair.generate().publicKey,
      recipient: Keypair.generate().publicKey,
    }));
    const res = await send(env, owner, updateNftAssignmentsIx(env, owner, nine), [owner]);
    assertErr(res, "TooManyNftAssignments");
  });
});

describe("heres: sealed inheritance boundary", () => {
  it("seals the configuration and arms the draft", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const beneficiaries = [{ pubkey: Keypair.generate().publicKey, shareBps: 10000 }];
    assertOk(await send(env, owner, updateIntentIx(env, owner, beneficiaries), [owner]));

    const commitment = inheritanceCommitment(owner.publicKey, beneficiaries, []);
    assertOk(
      await send(env, owner, sealInheritanceIx(env, owner, beneficiaries, []), [owner]),
      "seal_inheritance"
    );
    assertOk(await send(env, owner, armCapsuleIx(env, owner, commitment), [owner]), "arm_capsule");

    const cap = await fetchCapsule(env, owner.publicKey);
    expect(cap.isActive).to.eq(true);
  });

  it("rejects every beneficiary edit after sealing", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const beneficiaries = [{ pubkey: Keypair.generate().publicKey, shareBps: 10000 }];
    assertOk(await send(env, owner, updateIntentIx(env, owner, beneficiaries), [owner]));
    assertOk(await send(env, owner, sealInheritanceIx(env, owner, beneficiaries, []), [owner]));

    const replacement = [{ pubkey: Keypair.generate().publicKey, shareBps: 10000 }];
    const res = await send(env, owner, updateIntentIx(env, owner, replacement), [owner]);
    assertErr(res, "InheritanceAlreadySealed");
  });

  it("rejects a commitment that does not match the private configuration", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const beneficiaries = [{ pubkey: Keypair.generate().publicKey, shareBps: 10000 }];
    assertOk(await send(env, owner, updateIntentIx(env, owner, beneficiaries), [owner]));

    const wrongCommitment = Array(32).fill(99);
    const res = await send(
      env,
      owner,
      env.program.methods
        .sealInheritance(TEST_CONFIG_SALT, wrongCommitment)
        .accountsPartial({ beneficiarySet: beneficiarySetPda(owner.publicKey), owner: owner.publicKey }),
      [owner]
    );
    assertErr(res, "InvalidConfigurationCommitment");
  });

  it("rejects a zero salt", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const beneficiaries = [{ pubkey: Keypair.generate().publicKey, shareBps: 10000 }];
    const zeroSalt = Array(32).fill(0);
    assertOk(await send(env, owner, updateIntentIx(env, owner, beneficiaries), [owner]));

    const res = await send(
      env,
      owner,
      env.program.methods
        .sealInheritance(
          zeroSalt,
          inheritanceCommitment(owner.publicKey, beneficiaries, [], zeroSalt)
        )
        .accountsPartial({ beneficiarySet: beneficiarySetPda(owner.publicKey), owner: owner.publicKey }),
      [owner]
    );
    assertErr(res, "InvalidConfigurationCommitment");
  });

  it("rejects a zero configuration commitment", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const beneficiaries = [{ pubkey: Keypair.generate().publicKey, shareBps: 10000 }];
    assertOk(await send(env, owner, updateIntentIx(env, owner, beneficiaries), [owner]));

    const res = await send(
      env,
      owner,
      env.program.methods
        .sealInheritance(TEST_CONFIG_SALT, Array(32).fill(0))
        .accountsPartial({ beneficiarySet: beneficiarySetPda(owner.publicKey), owner: owner.publicKey }),
      [owner]
    );
    assertErr(res, "InvalidConfigurationCommitment");
  });

  it("rejects re-arming an active capsule", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const beneficiaries = [{ pubkey: Keypair.generate().publicKey, shareBps: 10000 }];
    const commitment = inheritanceCommitment(owner.publicKey, beneficiaries, []);
    assertOk(await send(env, owner, updateIntentIx(env, owner, beneficiaries), [owner]));
    assertOk(await send(env, owner, sealInheritanceIx(env, owner, beneficiaries, []), [owner]));
    assertOk(await send(env, owner, armCapsuleIx(env, owner, commitment), [owner]));

    const res = await send(env, owner, armCapsuleIx(env, owner, Array(32).fill(55)), [owner]);
    assertErr(res, "CapsuleNotDraft");
  });

  it("rejects NFT assignment edits after sealing", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const beneficiaries = [{ pubkey: Keypair.generate().publicKey, shareBps: 10000 }];
    assertOk(await send(env, owner, updateIntentIx(env, owner, beneficiaries), [owner]));
    assertOk(await send(env, owner, sealInheritanceIx(env, owner, beneficiaries, []), [owner]));

    const res = await send(
      env,
      owner,
      updateNftAssignmentsIx(env, owner, [{
        mint: Keypair.generate().publicKey,
        recipient: beneficiaries[0].pubkey,
      }]),
      [owner]
    );
    assertErr(res, "InheritanceAlreadySealed");
  });

  it("refuses settlement if the Switch was armed with a different commitment", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    const recipient = Keypair.generate().publicKey;
    const beneficiaries = [{ pubkey: recipient, shareBps: 10000 }];
    assertOk(await send(env, owner, updateIntentIx(env, owner, beneficiaries), [owner]));
    assertOk(await send(env, owner, sealInheritanceIx(env, owner, beneficiaries, []), [owner]));
    assertOk(await send(env, owner, armCapsuleIx(env, owner, Array(32).fill(55)), [owner]));
    assertOk(await send(env, owner, depositSolIx(env, owner, LAMPORTS_PER_SOL), [owner]));

    await warp(env, 200);
    assertOk(await send(env, env.payer, executeIntentIx(env, owner.publicKey)));
    const res = await send(env, env.payer, distributeSolIx(env, owner.publicKey, [recipient]));
    assertErr(res, "InvalidConfigurationCommitment");
  });
});

describe("heres: execute_intent", () => {
  it("rejects firing before the inactivity period elapses", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    await sealAndArm(env, owner);
    await warp(env, DAY - 60); // still 60s short
    const res = await send(env, env.payer, executeIntentIx(env, owner.publicKey));
    assertErr(res, "InactivityPeriodNotMet");
  });

  it("fires permissionlessly once inactivity elapses", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    await sealAndArm(env, owner);
    await warp(env, 200);
    const cranker = await fundedKeypair(env, 5); // not the owner
    const res = await send(env, cranker, executeIntentIx(env, owner.publicKey));
    assertOk(res, "execute_intent");

    const cap = await fetchCapsule(env, owner.publicKey);
    expect(cap.isActive).to.eq(false);
    expect(cap.executedAt).to.not.eq(null);
  });

  it("rejects a double fire", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    await fire(env, owner, 100);
    // distinct fee payer so the retry is not a duplicate signature (which would be rejected
    // pre-execution, before the program can raise CapsuleInactive)
    const cranker = await fundedKeypair(env, 5);
    const res = await send(env, cranker, executeIntentIx(env, owner.publicKey));
    assertErr(res, "CapsuleInactive");
  });
});

describe("heres: execute_intent target_date", () => {
  it("fires on the target_date even while the owner is still well within the inactivity window", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await fundedKeypair(env, 50);
    const now = await getNow(env);
    // Long inactivity (30 days) so only the absolute date can trigger; target 100s out.
    const created = await send(
      env,
      owner,
      createCapsuleIx(env, owner, 30 * DAY, owner.publicKey, null, new BN(now + 100)),
      [owner]
    );
    assertOk(created, "create_capsule (with target_date)");
    await sealAndArm(env, owner);

    await warp(env, 300); // past target_date, nowhere near the 30-day inactivity deadline
    const cranker = await fundedKeypair(env, 5); // permissionless: not the owner
    const res = await send(env, cranker, executeIntentIx(env, owner.publicKey));
    assertOk(res, "execute_intent (target_date)");

    const cap = await fetchCapsule(env, owner.publicKey);
    expect(cap.isActive).to.eq(false);
    expect(cap.executedAt).to.not.eq(null);
  });

  it("rejects firing when neither the inactivity period nor the target_date has been reached", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await fundedKeypair(env, 50);
    const now = await getNow(env);
    const created = await send(
      env,
      owner,
      createCapsuleIx(env, owner, DAY, owner.publicKey, null, new BN(now + 10000)),
      [owner]
    );
    assertOk(created, "create_capsule (with target_date)");
    await sealAndArm(env, owner);

    await warp(env, 100); // before both triggers
    const res = await send(env, env.payer, executeIntentIx(env, owner.publicKey));
    assertErr(res, "InactivityPeriodNotMet");
  });

  it("rejects a target_date in the past at creation", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await fundedKeypair(env, 50);
    const now = await getNow(env);
    const res = await send(
      env,
      owner,
      createCapsuleIx(env, owner, DAY, owner.publicKey, null, new BN(now - 100)),
      [owner]
    );
    assertErr(res, "InvalidTargetDate");
  });
});

describe("heres: update_activity", () => {
  it("owner bumps the liveness clock", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    await sealAndArm(env, owner);
    await warp(env, 1000);
    const now = await getNow(env);
    assertOk(
      await send(env, owner, updateActivityIx(env, owner.publicKey, owner.publicKey), [owner])
    );
    const cap = await fetchCapsule(env, owner.publicKey);
    expect(cap.lastActivity.toNumber()).to.eq(now);
  });

  it("heartbeat authority can bump", async () => {
    const env = await startEnv({ creationFee: 0 });
    const heartbeat = await fundedKeypair(env, 5);
    const owner = await freshCapsule(env, DAY, heartbeat.publicKey);
    await sealAndArm(env, owner);
    assertOk(
      await send(
        env,
        heartbeat,
        updateActivityIx(env, owner.publicKey, heartbeat.publicKey),
        [heartbeat]
      ),
      "heartbeat bump"
    );
  });

  it("rejects heartbeat updates after the capsule fires", async () => {
    const env = await startEnv({ creationFee: 0 });
    const heartbeat = await fundedKeypair(env, 5);
    const owner = await freshCapsule(env, 100, heartbeat.publicKey);
    await fire(env, owner, 100);
    const res = await send(
      env,
      heartbeat,
      updateActivityIx(env, owner.publicKey, heartbeat.publicKey),
      [heartbeat]
    );
    assertErr(res, "CapsuleInactive");
  });

  it("rejects a stranger", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    await sealAndArm(env, owner);
    const stranger = await fundedKeypair(env, 5);
    const res = await send(
      env,
      stranger,
      updateActivityIx(env, owner.publicKey, stranger.publicKey),
      [stranger]
    );
    assertErr(res, "Unauthorized");
  });

  it("rejects owner updates after the capsule fires", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    await fire(env, owner, 100);
    const res = await send(
      env,
      owner,
      updateActivityIx(env, owner.publicKey, owner.publicKey),
      [owner]
    );
    assertErr(res, "CapsuleInactive");
  });
});

describe("heres: distribute_assets (SOL)", () => {
  async function armed(env: Env, shares: number[], deposit: number) {
    const owner = await freshCapsule(env, 100);
    assertOk(await send(env, owner, depositSolIx(env, owner, deposit), [owner]));
    const recipients = shares.map(() => Keypair.generate().publicKey);
    const list = recipients.map((pubkey, i) => ({ pubkey, shareBps: shares[i] }));
    assertOk(await send(env, owner, updateIntentIx(env, owner, list), [owner]));
    await sealAndArm(env, owner);
    return { owner, recipients };
  }

  it("rejects distribution while the capsule is still active", async () => {
    const env = await startEnv({ creationFee: 0 });
    const { owner, recipients } = await armed(env, [10000], LAMPORTS_PER_SOL);
    const res = await send(env, env.payer, distributeSolIx(env, owner.publicKey, recipients));
    assertErr(res, "CapsuleActive");
  });

  it("settles immediately after firing", async () => {
    const env = await startEnv({ creationFee: 0 });
    const deposit = LAMPORTS_PER_SOL;
    const { owner, recipients } = await armed(env, [10000], deposit);
    await fire(env, owner, 100);
    assertOk(
      await send(env, env.payer, distributeSolIx(env, owner.publicKey, recipients)),
      "immediate distribution"
    );
    expect(await lamportsOf(env, recipients[0])).to.eq(deposit);
  });

  it("splits SOL by share_bps", async () => {
    const env = await startEnv({ creationFee: 0 });
    const deposit = LAMPORTS_PER_SOL;
    const { owner, recipients } = await armed(env, [6000, 4000], deposit);
    await fire(env, owner, 100);
    assertOk(
      await send(env, env.payer, distributeSolIx(env, owner.publicKey, recipients)),
      "distribute sol"
    );
    expect(await lamportsOf(env, recipients[0])).to.eq(Math.floor((deposit * 6000) / 10000));
    expect(await lamportsOf(env, recipients[1])).to.eq(deposit - Math.floor((deposit * 6000) / 10000));
  });

  it("last beneficiary absorbs the rounding remainder", async () => {
    const env = await startEnv({ creationFee: 0 });
    const deposit = 1_000_000_001; // not divisible by the shares
    const shares = [3333, 3333, 3334];
    const { owner, recipients } = await armed(env, shares, deposit);
    await fire(env, owner, 100);
    assertOk(await send(env, env.payer, distributeSolIx(env, owner.publicKey, recipients)));

    const b0 = Math.floor((deposit * shares[0]) / 10000);
    const b1 = Math.floor((deposit * shares[1]) / 10000);
    const b2 = deposit - b0 - b1; // last absorbs remainder
    expect(await lamportsOf(env, recipients[0])).to.eq(b0);
    expect(await lamportsOf(env, recipients[1])).to.eq(b1);
    expect(await lamportsOf(env, recipients[2])).to.eq(b2);
    expect(b0 + b1 + b2).to.eq(deposit);
  });

  it("is idempotent: re-running finds an empty vault", async () => {
    const env = await startEnv({ creationFee: 0 });
    const { owner, recipients } = await armed(env, [10000], LAMPORTS_PER_SOL);
    await fire(env, owner, 100);
    assertOk(await send(env, env.payer, distributeSolIx(env, owner.publicKey, recipients)));
    // distinct fee payer so the second call is a fresh signature, not a rejected duplicate
    const cranker = await fundedKeypair(env, 5);
    const res = await send(env, cranker, distributeSolIx(env, owner.publicKey, recipients));
    assertErr(res, "NothingToDistribute");
  });

  it("rejects sealing when no beneficiaries are set", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    assertOk(await send(env, owner, depositSolIx(env, owner, LAMPORTS_PER_SOL), [owner]));
    const res = await send(
      env,
      owner,
      sealInheritanceIx(env, owner, [], []),
      [owner]
    );
    assertErr(res, "NoBeneficiaries");
  });
});

describe("heres: beneficiary validation", () => {
  it("rejects duplicate beneficiary addresses", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const recipient = Keypair.generate().publicKey;
    const res = await send(
      env,
      owner,
      updateIntentIx(env, owner, [
        { pubkey: recipient, shareBps: 5000 },
        { pubkey: recipient, shareBps: 5000 },
      ]),
      [owner]
    );
    assertErr(res, "InvalidBeneficiaryAddress");
  });

  it("rejects zero-share beneficiaries", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const res = await send(
      env,
      owner,
      updateIntentIx(env, owner, [
        { pubkey: Keypair.generate().publicKey, shareBps: 10000 },
        { pubkey: Keypair.generate().publicKey, shareBps: 0 },
      ]),
      [owner]
    );
    assertErr(res, "InvalidBeneficiaryAddress");
  });

  it("rejects the capsule vault as a beneficiary", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const res = await send(
      env,
      owner,
      updateIntentIx(env, owner, [
        { pubkey: vaultPda(owner.publicKey), shareBps: 10000 },
      ]),
      [owner]
    );
    assertErr(res, "InvalidBeneficiaryAddress");
  });
});

describe("heres: distribute_assets (SPL)", () => {
  it("splits SPL tokens to beneficiary ATAs and closes the vault ATA", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    const mintAuth = await fundedKeypair(env, 5);
    const mint = await createMint(env, mintAuth.publicKey);
    const ownerAta = await createAta(env, owner.publicKey, mint);
    await mintTo(env, mint, ownerAta, mintAuth, 1_000_000n);
    assertOk(await send(env, owner, depositSplIx(env, owner, 1_000_000n, mint, ownerAta), [owner]));

    const b0 = Keypair.generate().publicKey;
    const b1 = Keypair.generate().publicKey;
    const b0Ata = await createAta(env, b0, mint);
    const b1Ata = await createAta(env, b1, mint);
    assertOk(
      await send(
        env,
        owner,
        updateIntentIx(env, owner, [
          { pubkey: b0, shareBps: 7000 },
          { pubkey: b1, shareBps: 3000 },
        ]),
        [owner]
      )
    );

    await fire(env, owner, 100);
    assertOk(
      await send(env, env.payer, distributeSplIx(env, owner.publicKey, mint, [b0Ata, b1Ata])),
      "distribute spl"
    );

    expect(await tokenBalance(env, b0Ata)).to.eq(700_000n);
    expect(await tokenBalance(env, b1Ata)).to.eq(300_000n);
    // vault ATA drained + closed
    const vaultAta = ataFor(vaultPda(owner.publicKey), mint, true);
    expect(await accountExists(env, vaultAta)).to.eq(false);
  });

  it("does not let an unregistered mint consume a registered manifest leg", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    const mintAuth = await fundedKeypair(env, 5);
    const registeredMint = await createMint(env, mintAuth.publicKey);
    const spamMint = await createMint(env, mintAuth.publicKey);
    const ownerAta = await createAta(env, owner.publicKey, registeredMint);
    await mintTo(env, registeredMint, ownerAta, mintAuth, 10n);
    assertOk(
      await send(env, owner, depositSplIx(env, owner, 10n, registeredMint, ownerAta), [owner])
    );

    // A third party can create and fund the vault's canonical ATA directly, but cannot set its
    // close-authority marker because only the vault PDA can sign for that change.
    const spamVaultAta = await createAta(env, vaultPda(owner.publicKey), spamMint, true);
    await mintTo(env, spamMint, spamVaultAta, mintAuth, 20n);

    const recipient = Keypair.generate().publicKey;
    const registeredRecipientAta = await createAta(env, recipient, registeredMint);
    const spamRecipientAta = await createAta(env, recipient, spamMint);
    assertOk(
      await send(
        env,
        owner,
        updateIntentIx(env, owner, [{ pubkey: recipient, shareBps: 10000 }]),
        [owner]
      )
    );
    await fire(env, owner, 100);

    assertOk(
      await send(env, env.payer, distributeSplIx(env, owner.publicKey, spamMint, [spamRecipientAta]))
    );
    assertOk(await send(env, env.payer, distributeSolIx(env, owner.publicKey, [recipient])));

    const premature = await send(
      env,
      owner,
      finalizeIx(env, owner.publicKey, owner.publicKey),
      [owner]
    );
    assertErr(premature, "VaultNotEmpty");
    expect(await tokenBalance(env, registeredRecipientAta)).to.eq(0n);

    assertOk(
      await send(
        env,
        env.payer,
        distributeSplIx(env, owner.publicKey, registeredMint, [registeredRecipientAta])
      )
    );
    assertOk(await send(env, env.payer, distributeSolIx(env, owner.publicKey, [recipient])));
    assertOk(
      await send(env, owner, finalizeIx(env, owner.publicKey, owner.publicKey), [owner])
    );
    expect(await tokenBalance(env, registeredRecipientAta)).to.eq(10n);
    expect(await tokenBalance(env, spamRecipientAta)).to.eq(20n);
  });
});

describe("heres: distribute_nft", () => {
  async function nftCapsule(env: Env) {
    const owner = await freshCapsule(env, 100);
    const mintAuth = await fundedKeypair(env, 5);
    const mint = await createMint(env, mintAuth.publicKey, 0);
    const ownerAta = await createAta(env, owner.publicKey, mint);
    await mintTo(env, mint, ownerAta, mintAuth, 1n);
    assertOk(await send(env, owner, depositSplIx(env, owner, 1n, mint, ownerAta), [owner]));

    const recipient = Keypair.generate().publicKey;
    const recipientAta = await createAta(env, recipient, mint);
    assertOk(
      await send(
        env,
        owner,
        updateNftAssignmentsIx(env, owner, [{ mint, recipient }]),
        [owner]
      )
    );
    assertOk(
      await send(
        env,
        owner,
        updateIntentIx(env, owner, [{ pubkey: recipient, shareBps: 10000 }]),
        [owner]
      )
    );
    await fire(env, owner, 100);
    return { owner, mint, recipient, recipientAta };
  }

  it("transfers one NFT to its assigned recipient and closes the vault ATA", async () => {
    const env = await startEnv({ creationFee: 0 });
    const { owner, mint, recipient, recipientAta } = await nftCapsule(env);
    assertOk(
      await send(env, env.payer, distributeNftIx(env, owner.publicKey, mint, recipient, recipientAta)),
      "distribute nft"
    );

    expect(await tokenBalance(env, recipientAta)).to.eq(1n);
    expect(await accountExists(env, ataFor(vaultPda(owner.publicKey), mint, true))).to.eq(false);
  });

  it("rejects a recipient that is not assigned to the NFT", async () => {
    const env = await startEnv({ creationFee: 0 });
    const { owner, mint } = await nftCapsule(env);
    const attacker = Keypair.generate().publicKey;
    const attackerAta = await createAta(env, attacker, mint);
    const res = await send(
      env,
      env.payer,
      distributeNftIx(env, owner.publicKey, mint, attacker, attackerAta)
    );
    assertErr(res, "NftAssignmentNotFound");
  });

  it("rejects bypassing an NFT assignment through proportional SPL distribution", async () => {
    const env = await startEnv({ creationFee: 0 });
    const { owner, mint, recipientAta } = await nftCapsule(env);

    const res = await send(
      env,
      env.payer,
      distributeSplIx(env, owner.publicKey, mint, [recipientAta])
    );
    assertErr(res, "NftRequiresAssignedDistribution");
  });

  it("never permits proportional fallback for an explicitly assigned mint", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    const mintAuth = await fundedKeypair(env, 5);
    const mint = await createMint(env, mintAuth.publicKey, 6);
    const ownerAta = await createAta(env, owner.publicKey, mint);
    await mintTo(env, mint, ownerAta, mintAuth, 1n);
    assertOk(await send(env, owner, depositSplIx(env, owner, 1n, mint, ownerAta), [owner]));
    const recipient = Keypair.generate().publicKey;
    const recipientAta = await createAta(env, recipient, mint);
    assertOk(
      await send(
        env,
        owner,
        updateNftAssignmentsIx(env, owner, [{ mint, recipient }]),
        [owner]
      )
    );
    assertOk(
      await send(
        env,
        owner,
        updateIntentIx(env, owner, [{ pubkey: recipient, shareBps: 10000 }]),
        [owner]
      )
    );
    await fire(env, owner, 100);

    const res = await send(
      env,
      env.payer,
      distributeNftIx(env, owner.publicKey, mint, recipient, recipientAta)
    );
    assertErr(res, "InvalidNftMint");

    const fallback = await send(
      env,
      env.payer,
      distributeSplIx(env, owner.publicKey, mint, [recipientAta])
    );
    assertErr(fallback, "NftRequiresAssignedDistribution");
    expect(await tokenBalance(env, recipientAta)).to.eq(0n);
  });
});

describe("heres: recover_vault", () => {
  it("recovers locked SOL to the owner while active", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    assertOk(await send(env, owner, depositSolIx(env, owner, 3 * LAMPORTS_PER_SOL), [owner]));
    const before = await lamportsOf(env, owner.publicKey);
    assertOk(await send(env, owner, recoverSolIx(env, owner), [owner]), "recover sol");
    const after = await lamportsOf(env, owner.publicKey);
    // owner gets the 3 SOL back minus a tx fee
    expect(after).to.be.greaterThan(before + 2.9 * LAMPORTS_PER_SOL);
  });

  it("recovers locked SPL to the owner and closes the vault ATA", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const mintAuth = await fundedKeypair(env, 5);
    const mint = await createMint(env, mintAuth.publicKey);
    const ownerAta = await createAta(env, owner.publicKey, mint);
    await mintTo(env, mint, ownerAta, mintAuth, 500_000n);
    assertOk(await send(env, owner, depositSplIx(env, owner, 500_000n, mint, ownerAta), [owner]));

    assertOk(await send(env, owner, recoverSplIx(env, owner, mint), [owner]), "recover spl");
    expect(await tokenBalance(env, ownerAta)).to.eq(500_000n);
    expect(await accountExists(env, ataFor(vaultPda(owner.publicKey), mint, true))).to.eq(false);
  });

  it("rejects recovery after the switch has fired", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    assertOk(await send(env, owner, depositSolIx(env, owner, LAMPORTS_PER_SOL), [owner]));
    await fire(env, owner, 100);
    const res = await send(env, owner, recoverSolIx(env, owner), [owner]);
    assertErr(res, "CapsuleInactive");
  });

  it("rejects recovery by a non-owner", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    assertOk(await send(env, owner, depositSolIx(env, owner, LAMPORTS_PER_SOL), [owner]));
    const attacker = await fundedKeypair(env, 5);
    const res = await send(
      env,
      attacker,
      env.program.methods.recoverVault().accountsPartial({
        capsule: capsulePda(owner.publicKey),
        vault: vaultPda(owner.publicKey),
        owner: attacker.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: null,
        mint: null,
        vaultTokenAccount: null,
        ownerTokenAccount: null,
      }),
      [attacker]
    );
    assertFailed(res, "non-owner recover");
  });
});

describe("heres: cancel_capsule", () => {
  it("refunds SOL and closes the accounts", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    assertOk(await send(env, owner, depositSolIx(env, owner, 2 * LAMPORTS_PER_SOL), [owner]));
    assertOk(await send(env, owner, cancelSolIx(env, owner), [owner]), "cancel");
    expect(await accountExists(env, capsulePda(owner.publicKey))).to.eq(false);
    expect(await accountExists(env, beneficiarySetPda(owner.publicKey))).to.eq(false);
    expect(await accountExists(env, vaultPda(owner.publicKey))).to.eq(false);
  });

  it("refunds an SPL asset and closes the accounts", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const mintAuth = await fundedKeypair(env, 5);
    const mint = await createMint(env, mintAuth.publicKey);
    const ownerAta = await createAta(env, owner.publicKey, mint);
    await mintTo(env, mint, ownerAta, mintAuth, 400_000n);
    assertOk(await send(env, owner, depositSplIx(env, owner, 400_000n, mint, ownerAta), [owner]));

    assertOk(await send(env, owner, cancelSplIx(env, owner, mint), [owner]), "cancel spl");
    expect(await tokenBalance(env, ownerAta)).to.eq(400_000n);
    expect(await accountExists(env, capsulePda(owner.publicKey))).to.eq(false);
  });

  it("refuses to close a multi-mint vault until every token leg is recovered", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const mintAuth = await fundedKeypair(env, 5);
    const mintA = await createMint(env, mintAuth.publicKey);
    const mintB = await createMint(env, mintAuth.publicKey);
    const ownerAtaA = await createAta(env, owner.publicKey, mintA);
    const ownerAtaB = await createAta(env, owner.publicKey, mintB);
    await mintTo(env, mintA, ownerAtaA, mintAuth, 10n);
    await mintTo(env, mintB, ownerAtaB, mintAuth, 20n);
    assertOk(await send(env, owner, depositSplIx(env, owner, 10n, mintA, ownerAtaA), [owner]));
    assertOk(await send(env, owner, depositSplIx(env, owner, 20n, mintB, ownerAtaB), [owner]));

    const res = await send(env, owner, cancelSplIx(env, owner, mintA), [owner]);
    assertErr(res, "VaultNotEmpty");
    expect(await accountExists(env, capsulePda(owner.publicKey))).to.eq(true);
    expect(await tokenBalance(env, ataFor(vaultPda(owner.publicKey), mintA, true))).to.eq(10n);
    expect(await tokenBalance(env, ataFor(vaultPda(owner.publicKey), mintB, true))).to.eq(20n);
  });

  it("rejects cancel after the switch has fired", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    await fire(env, owner, 100);
    const res = await send(env, owner, cancelSolIx(env, owner), [owner]);
    assertErr(res, "CapsuleInactive");
  });
});

describe("heres: finalize_capsule", () => {
  it("rejects finalization before execution", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    await sealAndArm(env, owner);
    const res = await send(env, owner, finalizeIx(env, owner.publicKey, owner.publicKey), [owner]);
    assertErr(res, "CapsuleActive");
  });

  it("rejects finalization while a tracked asset remains", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    assertOk(await send(env, owner, depositSolIx(env, owner, LAMPORTS_PER_SOL), [owner]));
    await fire(env, owner, 100);
    const res = await send(env, owner, finalizeIx(env, owner.publicKey, owner.publicKey), [owner]);
    assertErr(res, "VaultNotEmpty");
  });

  it("rejects a rent destination that is not the configured fee recipient", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    await fire(env, owner, 100);
    const wrongRecipient = Keypair.generate().publicKey;
    const res = await send(
      env,
      owner,
      finalizeIx(env, owner.publicKey, owner.publicKey, wrongRecipient),
      [owner]
    );
    assertErr(res, "InvalidFeeConfig");
  });

  it("rejects finalization by an unrelated signer", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    const attacker = await fundedKeypair(env, 1);
    await fire(env, owner, 100);
    const res = await send(
      env,
      attacker,
      finalizeIx(env, owner.publicKey, attacker.publicKey),
      [attacker]
    );
    assertErr(res, "Unauthorized");
  });

  it("lets the owner close a settled legacy capsule", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100, env.payer.publicKey);
    await fire(env, owner, 100);

    const vaultAddress = vaultPda(owner.publicKey);
    const legacyVault = await env.client.getAccount(vaultAddress);
    expect(legacyVault).to.not.eq(null);
    const data = Buffer.from(legacyVault!.data);
    data[8] = 1;
    env.context.setAccount(vaultAddress, { ...legacyVault!, data });

    const relayerAttempt = await send(
      env,
      env.payer,
      finalizeIx(env, owner.publicKey, env.payer.publicKey)
    );
    assertErr(relayerAttempt, "Unauthorized");
    assertOk(
      await send(env, owner, finalizeIx(env, owner.publicKey, owner.publicKey), [owner])
    );
    expect(await accountExists(env, capsulePda(owner.publicKey))).to.eq(false);
  });

  it("closes settled accounts to the protocol and permits fresh creation at the same PDAs", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100, env.payer.publicKey);
    const recipient = Keypair.generate().publicKey;
    assertOk(
      await send(
        env,
        owner,
        updateIntentIx(env, owner, [{ pubkey: recipient, shareBps: 10000 }]),
        [owner]
      )
    );
    assertOk(await send(env, owner, depositSolIx(env, owner, LAMPORTS_PER_SOL), [owner]));
    await fire(env, owner, 100);
    assertOk(await send(env, env.payer, distributeSolIx(env, owner.publicKey, [recipient])));

    const protocolBefore = await lamportsOf(env, env.feeRecipient);
    assertOk(
      await send(env, env.payer, finalizeIx(env, owner.publicKey, env.payer.publicKey)),
      "finalize settled capsule"
    );
    const protocolAfter = await lamportsOf(env, env.feeRecipient);
    expect(protocolAfter).to.be.greaterThan(protocolBefore);
    expect(await accountExists(env, capsulePda(owner.publicKey))).to.eq(false);
    expect(await accountExists(env, beneficiarySetPda(owner.publicKey))).to.eq(false);
    expect(await accountExists(env, vaultPda(owner.publicKey))).to.eq(false);

    assertOk(
      await send(
        env,
        owner,
        createCapsuleIx(env, owner, 7 * DAY, owner.publicKey),
        [owner]
      ),
      "create fresh capsule at the same PDAs"
    );
    const fresh = await fetchCapsule(env, owner.publicKey);
    expect(fresh).to.not.eq(null);
    expect(fresh.executedAt).to.eq(null);
    expect(fresh.inactivityPeriod.toNumber()).to.eq(7 * DAY);
  });
});

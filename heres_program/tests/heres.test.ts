// Heres lean program - structured bankrun test suite.
//
// Coverage (13 base-layer instructions + edge cases):
//   fee config .......... update_fee_config (authority gate, fee cap)
//   lifecycle ........... create_capsule, deposit (SOL+SPL), update_intent, cancel, recreate
//   firing .............. execute_intent (inactivity gate), update_activity (bump + grace revive)
//   distribution ........ distribute_assets (SOL+SPL, share split, remainder, grace gate, idempotency)
//   escape hatch ........ recover_vault (SOL+SPL, pre-fire only)
//
// init_fee_config (C3 upgrade-authority gate) and the 3 ER instructions (delegate/crank/schedule)
// are covered on devnet - bankrun loads the program non-upgradeable and has no MagicBlock programs.
// See scripts/init-fee-config.ts and tests/README.md.

import { assert, expect } from "chai";
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
  PERMISSION_PROGRAM_ID,
  GRACE_PERIOD,
  MAX_CREATION_FEE_LAMPORTS,
  capsulePda,
  vaultPda,
  feeConfigPda,
  permissionPda,
  ataFor,
  send,
  sendRaw,
  assertOk,
  assertErr,
  assertFailed,
  fetchCapsule,
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
  feeRecipient: PublicKey | null = null
) =>
  env.program.methods
    .createCapsule(new BN(inactivity), heartbeat)
    .accountsPartial({
      capsule: capsulePda(owner.publicKey),
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
  env.program.methods.updateIntent(beneficiaries).accountsPartial({
    capsule: capsulePda(owner.publicKey),
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
    permissionProgram: PERMISSION_PROGRAM_ID,
    permission: permissionPda(capsulePda(ownerPk)),
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
      vault: vaultPda(ownerPk),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      mint,
      vaultTokenAccount: ataFor(vaultPda(ownerPk), mint, true),
    })
    .remainingAccounts(
      recipientAtas.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false }))
    );

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
    vault: vaultPda(owner.publicKey),
    owner: owner.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    mint,
    vaultTokenAccount: ataFor(vaultPda(owner.publicKey), mint, true),
    ownerTokenAccount: ataFor(owner.publicKey, mint),
  });

const recreateIx = (env: Env, owner: Keypair, inactivity: number) =>
  env.program.methods.recreateCapsule(new BN(inactivity)).accountsPartial({
    capsule: capsulePda(owner.publicKey),
    owner: owner.publicKey,
  });

// ----- shared scenario helpers -----
const DAY = 24 * 60 * 60;

// create an active capsule for a fresh funded owner; returns the owner keypair
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

// drive a capsule to the fired state (is_active=false, executed_at set)
async function fire(env: Env, owner: Keypair, inactivity: number) {
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
  it("creates an active Switch + Vault with the expected state", async () => {
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
    expect(cap.isActive).to.eq(true);
    expect(cap.executedAt).to.eq(null);
    expect(cap.heartbeatAuthority.toBase58()).to.eq(heartbeat.toBase58());
    expect(cap.beneficiaries.length).to.eq(0);
    expect(await accountExists(env, vaultPda(owner.publicKey))).to.eq(true);
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
        .createCapsule(new BN(-1), owner.publicKey)
        .accountsPartial({
          capsule: capsulePda(owner.publicKey),
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

    const cap = await fetchCapsule(env, owner.publicKey);
    expect(cap.beneficiaries.length).to.eq(2);
    expect(cap.beneficiaries[0].shareBps).to.eq(6000);
    expect(cap.beneficiaries[1].shareBps).to.eq(4000);
    expect(cap.beneficiaries[0].pubkey.toBase58()).to.eq(list[0].pubkey.toBase58());
  });

  it("replaces an existing list", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    assertOk(await send(env, owner, updateIntentIx(env, owner, benes(2, [5000, 5000])), [owner]));
    const next = benes(3, [3000, 3000, 4000]);
    assertOk(await send(env, owner, updateIntentIx(env, owner, next), [owner]));
    const cap = await fetchCapsule(env, owner.publicKey);
    expect(cap.beneficiaries.length).to.eq(3);
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
      env.program.methods.updateIntent(benes(1, [10000])).accountsPartial({
        capsule: capsulePda(owner.publicKey),
        owner: stranger.publicKey,
      }),
      [stranger]
    );
    assertFailed(res, "non-owner update_intent");
  });
});

describe("heres: execute_intent", () => {
  it("rejects firing before the inactivity period elapses", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    await warp(env, DAY - 60); // still 60s short
    const res = await send(env, env.payer, executeIntentIx(env, owner.publicKey));
    assertErr(res, "InactivityPeriodNotMet");
  });

  it("fires permissionlessly once inactivity elapses", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
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

describe("heres: update_activity", () => {
  it("owner bumps the liveness clock", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
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

  it("heartbeat authority CANNOT revive a fired capsule (owner-only revive)", async () => {
    const env = await startEnv({ creationFee: 0 });
    const heartbeat = await fundedKeypair(env, 5);
    const owner = await freshCapsule(env, 100, heartbeat.publicKey);
    await fire(env, owner, 100);
    await warp(env, 60); // still well inside the 48h grace
    const res = await send(
      env,
      heartbeat,
      updateActivityIx(env, owner.publicKey, heartbeat.publicKey),
      [heartbeat]
    );
    assertErr(res, "Unauthorized");
  });

  it("rejects a stranger", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const stranger = await fundedKeypair(env, 5);
    const res = await send(
      env,
      stranger,
      updateActivityIx(env, owner.publicKey, stranger.publicKey),
      [stranger]
    );
    assertErr(res, "Unauthorized");
  });

  it("revives a fired capsule within the grace window", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    await fire(env, owner, 100);
    await warp(env, 60); // still well inside the 48h grace
    assertOk(
      await send(env, owner, updateActivityIx(env, owner.publicKey, owner.publicKey), [owner]),
      "revive"
    );
    const cap = await fetchCapsule(env, owner.publicKey);
    expect(cap.isActive).to.eq(true);
    expect(cap.executedAt).to.eq(null);
  });

  it("cannot revive after the grace window closes", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    await fire(env, owner, 100);
    await warp(env, GRACE_PERIOD + 60); // grace elapsed
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
    return { owner, recipients };
  }

  it("rejects distribution while the capsule is still active", async () => {
    const env = await startEnv({ creationFee: 0 });
    const { owner, recipients } = await armed(env, [10000], LAMPORTS_PER_SOL);
    const res = await send(env, env.payer, distributeSolIx(env, owner.publicKey, recipients));
    assertErr(res, "CapsuleActive");
  });

  it("rejects distribution before the grace window elapses", async () => {
    const env = await startEnv({ creationFee: 0 });
    const { owner, recipients } = await armed(env, [10000], LAMPORTS_PER_SOL);
    await fire(env, owner, 100);
    await warp(env, 60); // fired, but grace not elapsed
    const res = await send(env, env.payer, distributeSolIx(env, owner.publicKey, recipients));
    assertErr(res, "GracePeriodNotElapsed");
  });

  it("splits SOL by share_bps after grace", async () => {
    const env = await startEnv({ creationFee: 0 });
    const deposit = LAMPORTS_PER_SOL;
    const { owner, recipients } = await armed(env, [6000, 4000], deposit);
    await fire(env, owner, 100);
    await warp(env, GRACE_PERIOD + 10);
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
    await warp(env, GRACE_PERIOD + 10);
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
    await warp(env, GRACE_PERIOD + 10);
    assertOk(await send(env, env.payer, distributeSolIx(env, owner.publicKey, recipients)));
    // distinct fee payer so the second call is a fresh signature, not a rejected duplicate
    const cranker = await fundedKeypair(env, 5);
    const res = await send(env, cranker, distributeSolIx(env, owner.publicKey, recipients));
    assertErr(res, "NothingToDistribute");
  });

  it("rejects distribution when no beneficiaries are set", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    assertOk(await send(env, owner, depositSolIx(env, owner, LAMPORTS_PER_SOL), [owner]));
    await fire(env, owner, 100); // never set beneficiaries
    await warp(env, GRACE_PERIOD + 10);
    const res = await send(env, env.payer, distributeSolIx(env, owner.publicKey, []));
    assertErr(res, "NoBeneficiaries");
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
    await warp(env, GRACE_PERIOD + 10);
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

  it("rejects cancel after the switch has fired", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    await fire(env, owner, 100);
    const res = await send(env, owner, cancelSolIx(env, owner), [owner]);
    assertErr(res, "CapsuleInactive");
  });
});

describe("heres: recreate_capsule", () => {
  it("resets a fired capsule's lifecycle in place", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    assertOk(await send(env, owner, updateIntentIx(env, owner, [{ pubkey: Keypair.generate().publicKey, shareBps: 10000 }]), [owner]));
    await fire(env, owner, 100);

    assertOk(await send(env, owner, recreateIx(env, owner, 7 * DAY), [owner]), "recreate");
    const cap = await fetchCapsule(env, owner.publicKey);
    expect(cap.isActive).to.eq(true);
    expect(cap.executedAt).to.eq(null);
    expect(cap.inactivityPeriod.toNumber()).to.eq(7 * DAY);
    expect(cap.beneficiaries.length).to.eq(0);
  });

  it("rejects recreate on an active capsule", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, DAY);
    const res = await send(env, owner, recreateIx(env, owner, DAY), [owner]);
    assertErr(res, "CapsuleActive");
  });

  it("rejects a zero inactivity period on recreate", async () => {
    const env = await startEnv({ creationFee: 0 });
    const owner = await freshCapsule(env, 100);
    await fire(env, owner, 100);
    const res = await send(env, owner, recreateIx(env, owner, 0), [owner]);
    assertErr(res, "InvalidInactivityPeriod");
  });
});

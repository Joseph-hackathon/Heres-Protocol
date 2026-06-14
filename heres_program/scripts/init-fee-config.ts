// Initialize the global fee_config on the deployed devnet program, and exercise the C3
// upgrade-authority gate that bankrun cannot reach (it loads the program non-upgradeable).
//
//   1. negative: a throwaway signer attempting init_fee_config is rejected (C3 gate)
//   2. positive: the upgrade authority (heres-lean-deploy.json) initializes the singleton
//
// Run: yarn init-fee-config
// The Helius RPC URL (which embeds an API key) is read from the solana CLI config and never logged.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import idl from "../target/idl/heres_program.json";

const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

// --- fee config to set on devnet (frictionless: no creation fee; recipient = id.json treasury) ---
const FEE_RECIPIENT = new PublicKey("3wBhCBpCudbtfdaGdBRWhjsRq9B2yAkAgKadjJkVdAiA");
const CREATION_FEE = new BN(0);

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function rpcUrl(): string {
  const cfg = fs.readFileSync(
    path.join(os.homedir(), ".config/solana/cli/config.yml"),
    "utf8"
  );
  const m = cfg.match(/json_rpc_url:\s*"?([^"\s]+)"?/);
  if (!m) throw new Error("no json_rpc_url in solana CLI config");
  return m[1];
}

async function main() {
  const programId = new PublicKey((idl as any).address);
  const connection = new Connection(rpcUrl(), "confirmed");
  const authority = loadKeypair(
    path.join(os.homedir(), ".config/solana/heres-lean-deploy.json")
  );

  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config")],
    programId
  );
  const [programData] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_UPGRADEABLE
  );

  console.log("program     :", programId.toBase58());
  console.log("authority   :", authority.publicKey.toBase58());
  console.log("fee_config  :", feeConfig.toBase58());

  const existing = await connection.getAccountInfo(feeConfig);
  if (existing) {
    const provider = new AnchorProvider(connection, new Wallet(authority), {
      commitment: "confirmed",
    });
    const program = new Program(idl as any, provider);
    const cfg: any = await (program.account as any).feeConfig.fetch(feeConfig);
    console.log("\nfee_config already initialized:");
    console.log("  authority           :", cfg.authority.toBase58());
    console.log("  fee_recipient       :", cfg.feeRecipient.toBase58());
    console.log("  creation_fee_lamports:", cfg.creationFeeLamports.toString());
    return;
  }

  // ---- 1) C3 negative: a non-authority signer must be rejected ----
  const intruder = Keypair.generate();
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: intruder.publicKey,
      lamports: 0.02 * LAMPORTS_PER_SOL,
    })
  );
  const bh = await connection.getLatestBlockhash("confirmed");
  fundTx.recentBlockhash = bh.blockhash;
  fundTx.feePayer = authority.publicKey;
  fundTx.sign(authority);
  const fundSig = await connection.sendRawTransaction(fundTx.serialize());
  await connection.confirmTransaction(
    { signature: fundSig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
    "confirmed"
  );

  const intruderProgram = new Program(
    idl as any,
    new AnchorProvider(connection, new Wallet(intruder), { commitment: "confirmed" })
  );
  let rejected = false;
  try {
    await intruderProgram.methods
      .initFeeConfig(FEE_RECIPIENT, CREATION_FEE)
      .accountsPartial({
        feeConfig,
        authority: intruder.publicKey,
        program: programId,
        programData,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } catch (e: any) {
    rejected = true;
    console.log("\nC3 gate OK: non-authority init_fee_config rejected.");
  }
  if (!rejected) {
    throw new Error("SECURITY FAIL: non-authority init_fee_config was NOT rejected");
  }

  // ---- 2) positive: the upgrade authority initializes the singleton ----
  const program = new Program(
    idl as any,
    new AnchorProvider(connection, new Wallet(authority), { commitment: "confirmed" })
  );
  const sig = await program.methods
    .initFeeConfig(FEE_RECIPIENT, CREATION_FEE)
    .accountsPartial({
      feeConfig,
      authority: authority.publicKey,
      program: programId,
      programData,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("\ninit_fee_config tx:", sig);

  const cfg: any = await (program.account as any).feeConfig.fetch(feeConfig);
  console.log("fee_config initialized:");
  console.log("  authority            :", cfg.authority.toBase58());
  console.log("  fee_recipient        :", cfg.feeRecipient.toBase58());
  console.log("  creation_fee_lamports:", cfg.creationFeeLamports.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

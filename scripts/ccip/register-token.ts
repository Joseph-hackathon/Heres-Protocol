/**
 * CCIP Token Registration — Dry-Run + Manifest Generator
 *
 * Prepares every on-chain instruction for registering a new Solana SPL token
 * (solAUDD, USDC, etc.) with Chainlink CCIP.  This script does NOT broadcast
 * any transactions — it derives PDAs, validates them against the chain, and
 * writes a manifest that you can hand to Chainlink for their admin signature.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SCRIPT DOES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Step 1 — Derive Global Config PDA  (burn-mint token pool program)
 *  Step 2 — Derive Pool State PDA     (per mint)
 *  Step 3 — Token Admin Registry PDA  + proposeAdministrator instruction
 *            (this YOU can sign locally when MINT_AUTHORITY_KEYPAIR is set)
 *  Step 4 — Derive 10-base-entry ALT for the token pool
 *  Step 5 — Derive per-chain ChainConfig PDAs for all configured EVM chains
 *
 * Step 3a (proposeAdministrator) is the only step you can broadcast without
 * Chainlink's keys.  Chainlink must then:
 *   3b  acceptAdminRole
 *   4   sign ALT creation
 *   5   initChainRemoteConfig per EVM side
 *
 *  CCIP Program addresses (lib/ccip.ts):
 *    Router:        Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C
 *    FeeQuoter:     FeeQPGkKDeRV1MgoYfMH6L8o3KeuYjwUZrgn4LRKfjHi
 *    RMN:           RmnXLft1mSEwDgMKu2okYuHkiazxntFFcZFrrcXxYg7
 *    LINK mint:     LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L
 *    Burn-Mint Pool:5cSfCuzECV5BgD4z3ZzL5yHvX5pHrLqA5eZbNMnEhs9E
 *
 *  CCIP Chain Selectors (https://docs.chain.link/ccip/supported-networks/):
 *    Ethereum     500929755    Sepolia       1628171783
 *    Polygon      13235004270930276         BSC     6450786
 *    Base         1650553709   Arbitrum      1634886255
 *    Optimism     1869640809   Avalanche      1476748257
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * USAGE
 *   # Dry-run — just check PDAs and write manifest
 *   npx tsx scripts/ccip/register-token.ts --mint <SOLAUDD_MINT> --network devnet
 *
 *   # Actually broadcast Step 3a proposeAdministrator
 *   MINT_AUTHORITY_KEYPAIR=./keys/solaudd-authority.json \
 *   npx tsx scripts/ccip/register-token.ts --mint <SOLAUDD_MINT> --network devnet --broadcast
 */

import { AddressLookupTableProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'

const ROOT  = path.join(process.cwd())  // use cwd instead of __dirname (tsx ESM quirk)
const OUT   = path.join(ROOT, 'ccip-output')
const M_F   = path.join(OUT,  'transactions.json')

// ─── Network config ────────────────────────────────────────────────────────────

interface NetCfg {
  rpc: string
  router: string
  feeQuoter: string
  rmn: string
  linkMint: string
  poolProgram: string
  chains: Record<string, string>
}

const CFG: Record<string, NetCfg> = {
  devnet: {
    rpc:        process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    router:     'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C',
    feeQuoter:  'FeeQPGkKDeRV1MgoYfMH6L8o3KeuYjwUZrgn4LRKfjHi',
    rmn:        'RmnXLft1mSEwDgMKu2okYuHkiazxntFFcZFrrcXxYg7',
    linkMint:   'LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L',
    poolProgram:'5cSfCuzECV5BgD4z3ZzL5yHvX5pHrLqA5eZbNMnEhs9E',
    chains: {
      ethereum: '500929755',
      sepolia:  '1628171783',
    },
  },
  mainnet: {
    rpc:        process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    router:     'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C',
    feeQuoter:  'FeeQPGkKDeRV1MgoYfMH6L8o3KeuYjwUZrgn4LRKfjHi',
    rmn:        'RmnXLft1mSEwDgMKu2okYuHkiazxntFFcZFrrcXxYg7',
    linkMint:   'LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L',
    poolProgram:'5cSfCuzECV5BgD4z3ZzL5yHvX5pHrLqA5eZbNMnEhs9E',
    chains: {
      ethereum:  '500929755',
      sepolia:   '1628171783',
    },
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function loadKp(label: string, envKey: string | null): Keypair | null {
  if (!envKey || !envKey.trim()) { console.log(`  ⚠  No key for ${label}.  Set env ${envKey}=<path-or-base58>`); return null }
  try {
    const raw = JSON.parse(readFileSync(envKey, 'utf8'))
    return Keypair.fromSecretKey(Uint8Array.from(raw))
  } catch { console.log(`  ⚠  Cannot load keypair for ${label} from ${envKey}`); return null }
}

function pda(label: string, seeds: Buffer[], prog: PublicKey): PublicKey {
  const [p] = PublicKey.findProgramAddressSync(seeds, prog)
  console.log(`  [PDA] ${label.padEnd(35)} ${p.toBase58()}`)
  return p
}

async function signSend(conn: Connection, ixs: any[], kp: Keypair, label: string): Promise<string | null> {
  const { blockhash } = await conn.getLatestBlockhash('finalized')
  const tx = new Transaction({ feePayer: kp.publicKey, blockhash, recentBlockhash: blockhash })
  ixs.forEach((ix: any) => tx.add(ix))
  tx.sign([kp])
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true })
  await conn.confirmTransaction(sig, 'confirmed')
  console.log(`  ✓  ${label}: https://explorer.solana.com/tx/${sig}?cluster=devnet`)
  return sig
}

// ─── Steps ────────────────────────────────────────────────────────────────────

/** Step 1 — global_config on pool program (pool deployer/upgrade authority only) */
async function step1(
  conn: Connection, poolProg: PublicKey, router: PublicKey, rmn: PublicKey,
  mint: PublicKey, deployerKp: Keypair | null, broadcast: boolean
): Promise<ManifestStep> {
  console.log('\n── Step 1 — Global Config (burn-mint pool) ──────')
  const gcPDA = pda('GLOBAL_CONFIG', [Buffer.from('global_config')], poolProg)
  const pPoolState  = pda('POOL_STATE',   [Buffer.from('state'),      mint.toBuffer()], poolProg)
  const pPoolSigner = pda('POOL_SIGNER',  [Buffer.from('pool_signer'), mint.toBuffer()], poolProg)

  const exists = await conn.getAccountInfo(gcPDA)
  if (exists) { console.log('  ℹ  Already initialized — skip'); return { l: 'S1 global-config', s: 'already-exists' } }

  console.log(`  Pool prog: ${poolProg.toBase58()}`)
  console.log(`  Router:    ${router.toBase58()}`)
  console.log(`  RMN:       ${rmn.toBase58()}`)
  if (broadcast && deployerKp) {
    try {
      const ix = await buildInitGlobalConfig(poolProg, router, rmn, gcPDA, deployerKp.publicKey)
      const sig = await signSend(conn, [ix], deployerKp, 'S1 init_global_config')
      return { l: 'S1 global-config', s: sig ?? 'err' }
    } catch (e: any) {
      console.log(`  ⚠  ${e.message}`);
    }
  }
  console.log('  ✗  Set POOL_DEPLOYER_KEYPAIR=<path-or-base58> env var to broadcast')
  return { l: 'S1 global-config', s: `PDA:${gcPDA.toBase58()} NEEDS_POOL_DEPLOYER_KEY` }
}

/** Step 2 — initializePool (pool deployer/upgrade authority only) */
async function step2(
  conn: Connection, poolProg: PublicKey, mint: PublicKey,
  router: PublicKey, rmn: PublicKey,
  _deployerKp: Keypair | null, _broadcast: boolean
): Promise<ManifestStep> {
  console.log('\n── Step 2 — Token Pool Init ─────────────────────')
  pda('POOL_STATE',   [Buffer.from('state'),      mint.toBuffer()], poolProg)
  pda('POOL_SIGNER',  [Buffer.from('pool_signer'), mint.toBuffer()], poolProg)
  pda('GLOBAL_CONFIG',[Buffer.from('global_config')              ], poolProg)

  const [statePDA] = PublicKey.findProgramAddressSync([Buffer.from('state'), mint.toBuffer()], poolProg)
  const exists = await conn.getAccountInfo(statePDA)
  if (exists) { console.log('  ℹ  Pool state exists — skip'); return { l: 'S2 pool-init', s: statePDA.toBase58() } }

  console.log('  ✗  Set POOL_DEPLOYER_KEYPAIR and re-run with --broadcast')
  return { l: 'S2 pool-init', s: `PDA:${statePDA.toBase58()} NEEDS_POOL_DEPLOYER_KEY` }
}

/** Step 3 — Token Admin Registry handshake
 *  3a  proposeAdministrator  ← YOU sign with mint authority key
 *  3b  acceptAdminRole       ← Chainlink signs  (not in this script)
 */
async function step3(
  conn: Connection, router: PublicKey, mint: PublicKey,
  mintAuthorityKp: Keypair | null, chainlinkAdminPk: PublicKey | null,
  broadcast: boolean
): Promise<ManifestStep> {
  console.log('\n── Step 3 — Token Admin Registry Handshake ──────')
  const tarPDA = pda('TOKEN_ADMIN_REGISTRY', [Buffer.from('token_admin_registry'), mint.toBuffer()], router)

  const existing = (await conn.getAccountInfo(tarPDA))?.data
  if (existing && existing.length >= 73) {
    const admin      = new PublicKey(existing.slice(40, 72))
    const proposed   = new PublicKey(existing.slice(8,  40))
    console.log(`  ℹ  admin=${admin.toBase58()}  proposed=${proposed.toBase58()}`)
    if (chainlinkAdminPk && admin.equals(chainlinkAdminPk)) {
      console.log('  ℹ  Chainlink is already admin — skip');
      return { l: 'S3 admin-handshake', s: 'CHAINLINK_IS_ADMIN' }
    }
  }

  // 3a — proposeAdministrator  (mint authority → Chainlink)
  console.log(`\n  ── 3a proposeAdministrator (YOU sign) ─────────────`)
  console.log(`  Mint authority:  ${mintAuthorityKp?.publicKey.toBase58() ?? '???'}`)
  console.log(`  Proposed admin:  ${chainlinkAdminPk?.toBase58() ?? '<set CHAINLINK_ADMIN_PUBLIC_KEY>'}`)

  if (broadcast && mintAuthorityKp && chainlinkAdminPk) {
    try {
      const config = PublicKey.findProgramAddressSync([Buffer.from('ccip_config')], router)[0]
      const { ownerProposeAdministrator }: any = await import('../../vendor/ccip-svm/bindings/instructions')
      const ix = ownerProposeAdministrator(
        { tokenAdminRegistryAdmin: chainlinkAdminPk! },
        {
          config:              config,
          tokenAdminRegistry:  tarPDA,
          mint:                mint,
          authority:           mintAuthorityKp.publicKey,
          systemProgram:       PublicKey.default,
        },
        router
      )
      const sig = await signSend(conn, [ix], mintAuthorityKp, 'S3a proposeAdministrator')
      console.log(`  ✓  3a proposeAdministrator → ${sig}`)
      return { l: 'S3a proposeAdministrator', s: sig }
    } catch (e: any) {
      console.log(`  ⚠  3a SDK call failed: ${e.message}`)
      if (existing) {
        console.log(`  ℹ  TokenAdminRegistry PDA  → ${tarPDA.toBase58()}`)
        console.log(`  ℹ  TRY AGAIN: env already populated? Check PDA above — if proposed_admin = chainlink, this step is DONE`)
        return { l: 'S3a proposeAdministrator (checkPDA)', s: `PDA:${tarPDA.toBase58()} re-check above` }
      }
    }
  }

  if (!mintAuthorityKp) {
    console.log('  ✗  Set MINT_AUTHORITY_KEYPAIR=<path-or-base58> and rerun with --broadcast')
    return { l: 'S3 admin-handshake', s: `tarPDA:${tarPDA.toBase58()} NEEDS_MINT_AUTHORITY_KEY` }
  }
  if (!chainlinkAdminPk) {
    console.log('  ✗  Set CHAINLINK_ADMIN_PUBLIC_KEY=<base58-pubkey> and rerun with --broadcast')
    return { l: 'S3a proposeAdministrator (key missing)', s: `tarPDA:${tarPDA.toBase58()} NEEDS_CHAINLINK_ADMIN_PUBKEY` }
  }
}

/** Step 4 — ALT for token pool (Chainlink admin key required) */
async function step4(
  conn: Connection, router: PublicKey, feeQuoter: PublicKey,
  mint: PublicKey, poolProg: PublicKey, poolAdminKp: Keypair | null, broadcast: boolean
): Promise<ManifestStep> {
  console.log('\n── Step 4 — Token Pool ALT ──────────────────────')
  const tarPDA  = PublicKey.findProgramAddressSync(
    [Buffer.from('token_admin_registry'), mint.toBuffer()], router)[0]
  const poolCfg = PublicKey.findProgramAddressSync([Buffer.from('state'),  mint.toBuffer()], poolProg)[0]
  const poolSign = PublicKey.findProgramAddressSync([Buffer.from('pool_signer'), mint.toBuffer()], poolProg)[0]
  const poolTokenAcct = getAssociatedTokenAddressSync(mint, poolSign, true, TOKEN_PROGRAM_ID)
  const tokenProgram  = TOKEN_PROGRAM_ID

  async function getFeeBillingPDA() {
    try {
      // Vendored — may resolve differently in dev
      const pdas: any = await import('../../../vendor/ccip-svm/utils/pdas/feeQuoter')
      return pdas.findFqBillingTokenConfigPDA(mint, feeQuoter)[0]
    } catch {
      return PublicKey.findProgramAddressSync(
        [Buffer.from('fee_quoter_billing_token_config'), mint.toBuffer()],
        feeQuoter
      )[0]
    }
  }
  const [feeBillPDA, ccipPoolSign] = await (async () => {
    const [p1] = PublicKey.findProgramAddressSync(
      [Buffer.from('external_token_pools_signer'), poolProg.toBuffer()], router)
    return [await getFeeBillingPDA(), p1]
  })()

  const entries: PublicKey[] = [
    PublicKey.default,  // [0] self — replaced by createLT
    tarPDA,             // [1] token admin registry
    poolProg,           // [2] pool program
    poolCfg,            // [3] pool config
    poolTokenAcct,      // [4] pool token account
    poolSign,           // [5] pool signer
    tokenProgram,       // [6] token program
    mint,               // [7] token mint
    feeBillPDA,         // [8] fee billing token config
    ccipPoolSign,       // [9] CCIP router pool signer
  ]
  console.log(`  ${'Idx'.padStart(5)} ${'Address'.padEnd(56)} Label`)
  entries.forEach((e, i) => console.log(`  ${String(i).padStart(5)} ${e.toBase58().padEnd(56)} ${i === 0 ? '(ALT self)' : i === 1 ? 'token admin registry' : i === 2 ? 'pool program' : i === 3 ? 'pool config' : i === 4 ? 'pool token account' : i === 5 ? 'pool signer' : i === 6 ? 'token program' : i === 7 ? 'token mint' : i === 8 ? 'fee bill config' : 'CCIP pool signer'}`))

  if (broadcast && poolAdminKp) {
    const recentSlot = await conn.getSlot('finalized')
    const [cIx, lt] = AddressLookupTableProgram.createLookupTable({
      authority: poolAdminKp.publicKey, payer: poolAdminKp.publicKey, recentSlot,
    })
    const eIx = AddressLookupTableProgram.extendLookupTable({
      lookupTable: lt, authority: poolAdminKp.publicKey, payer: poolAdminKp.publicKey, addresses: entries,
    })
    const sig = await signSend(conn, [cIx, eIx], poolAdminKp, 'S4 ALT create+extend')
    console.log(`  ALT address → ${lt.toBase58()}`)
    return { l: 'S4 ALT', s: `${lt.toBase58()} → entries:${entries.length}` }
  }

  console.log('  ✗  Set CHAINLINK_ADMIN_KEYPAIR=<path-or-base58> and rerun with --broadcast')
  return { l: 'S4 ALT', s: `NEEDS_CHAINLINK_ADMIN KP — ${entries.length} entries prepared` }
}

/** Step 5 — initChainRemoteConfig per EVM destination chain  (Chainlink pool admin key required) */
async function step5(
  conn: Connection, poolProg: PublicKey, mint: PublicKey,
  decimals: number, selector: string, label: string,
  poolAdminKp: Keypair | null, broadcast: boolean
): Promise<ManifestStep> {
  console.log(`\n── Step 5 — Chain Remote Config: ${label} (${selector}) ──`)

  const [statePDA] = PublicKey.findProgramAddressSync([Buffer.from('state'), mint.toBuffer()], poolProg)
  const [ccPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('chain_config'), Buffer.from(new anchor.BN(selector).toArray('le', 8)), mint.toBuffer()],
    poolProg
  )
  pda('CHAIN_CONFIG', [Buffer.from('chain_config'), Buffer.from(new anchor.BN(selector).toArray('le', 8)), mint.toBuffer()], poolProg)

  const [poolSignPDA] = PublicKey.findProgramAddressSync([Buffer.from('pool_signer'), mint.toBuffer()], poolProg)
  const exists = await conn.getAccountInfo(ccPDA)
  if (exists) { console.log(`  ℹ  Chain config for ${label} already exists`); return { l: `S5-${label} chain-config`, s: ccPDA.toBase58() } }

  const remotePool = process.env[`REMOTE_POOL_${label.toUpperCase()}`]
  if (!remotePool) {
    console.log(`  Set REMOTE_POOL_${label.toUpperCase()}=<0xEVMPoolAddress> to broadcast`)
  }

  if (broadcast && poolAdminKp && remotePool) {
    try {
      const { initChainRemoteConfig } = await import('../../../vendor/ccip-svm/burnmint-pool-bindings/instructions')
      const { BN } = await import('@coral-xyz/anchor')
      const accounts = {
        state: statePDA, chainConfig: ccPDA,
        authority: poolAdminKp.publicKey,
        systemProgram: PublicKey.default,
      }
      const { BN: BN2 } = require('@coral-xyz/anchor')
      const tokenEvm = process.env[`REMOTE_TOKEN_${label.toUpperCase()}`] || ''
      const ix = initChainRemoteConfig(
        { remoteChainSelector: new BN(selector), mint, cfg: {
          poolAddresses: [Buffer.from(remotePool)],
          tokenAddress:   tokenEvm ? Buffer.from(tokenEvm.replace('0x',''), 'hex').padStart(32,0) : Buffer.alloc(32),
          decimals,
        }},
        accounts,
        poolProg
      )
      const sig = await signSend(conn, [ix], poolAdminKp, `S5-${label} initChainRemoteConfig`)
      return { l: `S5-${label} chain-config`, s: sig ?? 'err' }
    } catch (e: any) {
      console.log(`  ⚠  ${e.message}`)
    }
  }

  console.log('  ✗  Cannot broadcast — see messages above')
  return { l: `S5-${label} chain-config`, s: `NEEDS_CHAINLINK_ADMIN + EVM_${label}_ADDRESSES` }
}

// ─── Instruction builders ─────────────────────────────────────────────────────

async function buildInitGlobalConfig(
  poolProg: PublicKey, router: PublicKey, rmn: PublicKey, gcPDA: PublicKey, authority: PublicKey
): Promise<any> {
  const { initGlobalConfig, InitGlobalConfigAccounts } = await import('../../../vendor/ccip-svm/burnmint-pool-bindings/instructions')
  // Abstractix via vendored binder
  return initGlobalConfig(
    { routerAddress: router, rmnAddress: rmn, args: {}, meta: {} },
    { config: gcPDA, authority, systemProgram: PublicKey.default, program: poolProg, programData:PublicKey.default } as any,
    poolProg
  )
}

async function buildProposeAdministrator(
  router: PublicKey, mint: PublicKey, authority: PublicKey,
  proposedAdmin: PublicKey, tarPDA: PublicKey
): Promise<any> {
  const { OwnerProposeAdministratorArgs, ownerProposeAdministrator, OwnerProposeAdministratorAccounts } =
    await import('../../../vendor/ccip-svm/bindings/instructions')
  return ownerProposeAdministrator(
    { tokenAdminRegistryAdmin: proposedAdmin },
    { config: PublicKey.findProgramAddressSync([Buffer.from('ccip_config')], router)[0], tokenAdminRegistry: tarPDA, mint, authority, systemProgram: PublicKey.default } as any,
    router
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function parseArgs(): { mint: string; symbol: string; network: string; broadcast: boolean } {
  const a = process.argv.slice(2)
  const f: Record<string, string> = {}
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith('--')) { f[a[i]!.slice(2)] = a[i+1] ?? '1'; if (!a[i+1]?.startsWith('--')) i++ }
  }
  return { mint: f.mint || process.env.NEXT_PUBLIC_SOLAUDD_MINT || '', symbol: f.symbol || 'SOLAUDD', network: f.network || 'devnet', broadcast: f.broadcast === '1' }
}

interface ManifestStep { l: string; s: string }

async function main() {
  const { mint: mintStr, symbol, network, broadcast } = parseArgs()
  if (!mintStr) { console.error('Usage: npx tsx scripts/ccip/register-token.ts --mint <MINT_ADDRESS> --network devnet [--broadcast]'); process.exit(1) }

  const cfg     = CFG[network]!
  const mint    = new PublicKey(mintStr)
  const conn    = new Connection(cfg.rpc, 'confirmed')
  const router  = new PublicKey(cfg.router)
  const poolProg= new PublicKey(cfg.poolProgram)
  const fq      = new PublicKey(cfg.feeQuoter)
  const rmn     = new PublicKey(cfg.rmn)

  const minfo = await conn.getParsedAccountInfo(mint)
  const decimals  = minfo.value?.data?.parsed?.info?.decimals ?? 6
  const mintAuth  = loadKp('MINT_AUTHORITY',   process.env.MINT_AUTHORITY_KEYPAIR ?? null)
  const poolAdmin = loadKp('POOL_ADMIN',       process.env.POOL_DEPLOYER_KEYPAIR ?? null)
  const cliAdmin  = loadKp('CHAINLINK_ADMIN',  process.env.CHAINLINK_ADMIN_KEYPAIR ?? null)
  const cliPk  = cliAdmin  ? cliAdmin.publicKey : process.env.CHAINLINK_ADMIN_PUBLIC_KEY ? new PublicKey(process.env.CHAINLINK_ADMIN_PUBLIC_KEY) : null

  console.log('\n╔══════════════════════════════════════════════╗')
  console.log(`║  CCIP Registration — ${(symbol + ' ').padEnd(25)}║`)
  console.log(`║  Network:    ${network.padEnd(31)}║`)
  console.log(`║  Mint:       ${(mintStr + ' ').padEnd(31)}║`)
  console.log(`║  Decimals:   ${String(decimals).padEnd(31)}║`)
  console.log(`╚══════════════════════════════════════════════╝`)
  console.log(`\n  Mint decimals: ${decimals}`)
  console.log(`  Pool program:  ${poolProg.toBase58()}`)
  console.log(`  Router:        ${router.toBase58()}`)
  console.log(`  FeeQuoter:     ${fq.toBase58()}`)
  console.log(`  RMN:           ${rmn.toBase58()}`)
  console.log(`  LINK mint:     ${cfg.linkMint}`)

  const steps: ManifestStep[] = []

  // Non-broadcast steps (always dry-run for pool-admin-gated ones)
  steps.push(await step1(conn, poolProg, router, rmn, mint, poolAdmin, broadcast))
  steps.push(await step2(conn, poolProg, mint, router, rmn, poolAdmin, broadcast))

  // Step 3 — proposeAdministrator (can broadcast locally)
  const proposeResult = await step3(conn, router, mint, mintAuth, cliPk, broadcast)
  steps.push(proposeResult)

  // Step 4 — ALT (Chainlink admin)
  steps.push(await step4(conn, router, fq, mint, poolProg, cliAdmin ?? null, broadcast))

  // Step 5 — per-chain
  for (const [label, selector] of Object.entries(cfg.chains)) {
    steps.push(await step5(conn, poolProg, mint, decimals, selector, label, cliAdmin ?? null, broadcast))
  }

  // Save manifest
  mkdirSync(OUT, { recursive: true })
  writeFileSync(M_F, JSON.stringify({
    token:   mintStr, symbol, network, mint: mintStr, decimals,
    generatedAt: new Date().toISOString(),
    steps:   steps.map(s => ({ label: s.l, signal: s.s })),
    chainSelectors: cfg.chains,
  }, null, 2))
  console.log(`\n📦  Manifest → ${M_F}\n`)

  // Summary
  console.log('══════════════════════════════════════════════════════════════')
  console.log('  REGISTRATION READINESS')
  console.log('══════════════════════════════════════════════════════════════')
  console.log(`
  ✓ You CAN sign locally (set proper keypair env first):
      Step 3a — proposeAdministrator
        Set MINT_AUTHORITY_KEYPAIR=<path-or-base58-keypair>
        rerun with --broadcast
        → saves the tx sig.  Attach it to your Chainlink ticket.

  ✗ Chainlink MUST sign these (their CCIP admin keys required):
      Step 1  — initializeGlobalConfig (pool deployer authority)
      Step 2  — initializePool          (pool admin authority)
      Step 3b — acceptAdminRole         (Chainlink CCIP admin)
      Step 4  — createTokenPoolLT       (Chainlink pool admin)
      Step 5  — initChainRemoteConfig   x${Object.keys(cfg.chains).length} (pool admin)

  ⚠ BEFORE asking Chainlink, SHARE IN YOUR TICKET:
      Mint address:      ${mintStr}
      Mint decimals:     ${decimals}
      Pool program:      ${cfg.poolProgram}
      Router:            ${cfg.router}
      FeeQuoter:         ${cfg.feeQuoter}
      RMN:               ${cfg.rmn}
      LINK mint:         ${cfg.linkMint}
      propose tx sig:    (run --broadcast + MINT_AUTHORITY_KEYPAIR first)
      solAUDD EVM side (per chain — Chainlink needs this too):
${Object.entries(cfg.chains).map(([l, s]) =>
  `        ${l.padEnd(12)} selector=${s}\n` +
  `          REMOTE_POOL_${l.toUpperCase()}=<0xEVM_pool_address>\n` +
  `          REMOTE_TOKEN_${l.toUpperCase()}=<0xEVM_solAUDD_address>`
).join('\n')}
  `)
}

main().catch(e => { console.error(e); process.exit(1) })

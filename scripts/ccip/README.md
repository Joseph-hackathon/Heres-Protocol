# CCIP + CRE Pre-Listing Package

This directory holds everything you need to validate local readiness and send a
complete, data-rich listing request to Chainlink before they provide CCIP admin
access.

---

## Quick Start

```bash
# 1 — PDAs + manifest (no keys needed — always safe to run)
npx tsx scripts/ccip/register-token.ts --mint <SOLAUDD_MINT> --network devnet

# 2 — Local CRE wiring test (starts dev server first)
npm run dev   # in another terminal
npx tsx scripts/cre/test-local-cre.ts

# 3 — Actually sign proposeAdministrator (YOU — mint authority only)
MINT_AUTHORITY_KEYPAIR=./keys/solaudd-authority.json \
  npx tsx scripts/ccip/register-token.ts --mint <SOLAUDD_MINT> --network devnet --broadcast
# → captures the tx sig; paste it in your Chainlink ticket
```

---

## File inventory

| File | Purpose |
|---|---|
| `scripts/ccip/register-token.ts` | CCIP token registration — dry-run manifest + broadcast option |
| `scripts/cre/test-local-cre.ts` | Local CRE wiring test — runs against mock endpoints |
| `transactions.json` | Output manifest (written to `ccip-output/` on run) |
| `CHAINLINK_TICKET.md` | Exact copy-paste block for Chainlink CCIP team |
| `CRE_OPS.md` | CRE ops handoff doc for Chainlink ops team |

---

## What each script validates

### register-token.ts  (5 steps)

| Step | What | Who signs |
|------|------|-----------|
| 1 — Global Config | Pool program's `init_global_config` | Pool deployer/upgrade authority |
| 2 — Pool Init | `initializePool(mint)` | Pool deployer/upgrade authority |
| 3a — proposeAdministrator | Token Admin Registry `ownerProposeAdministrator` | **You** (mint authority) ← can broadcast |
| 3b — acceptAdminRole | Chainlink accepts proposed admin | **Chainlink** |
| 4 — ALT create+extend | Pool lookup table with 10 base entries | **Chainlink pool admin** |
| 5 — initChainRemoteConfig | Per-EVM chain: pool address + token address | **Chainlink pool admin** × N chains |

### test-local-cre.ts  (5 tests)

| Test | What |
|------|------|
| 1 — Mock dispatch | POSTs to `/api/mock/cre`, checks auto-callback fires |
| 2 — Mock reminder | POSTs to `/api/mock/cre-reminder`, checks auto-callback |
| 3 — Force-fail | `MOCK_CRE_FORCE_FAIL=true` confirms error-path handling |
| 4 — RPC + PDA | Verifies RPC connection and derives capsule/vault PDAs |
| 5 — Live capsule | Reads a real capsule's intent data (pass `OWNER_ADDRESS=…` env) |

---

## Prerequisites

| Variable | Where to set | Example |
|---|---|---|
| `NEXT_PUBLIC_SOLAUDD_MINT` | `.env.local` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (or solAUDD mainnet mint) |
| `CHAINLINK_ADMIN_PUBLIC_KEY` | shell env | `0x…` (not your key — read from ticket reply) |
| `MINT_AUTHORITY_KEYPAIR` | shell env | `./keys/solaudd-authority.json` or base58 private key |
| `POOL_DEPLOYER_KEYPAIR` | shell env | Pool program deployer key (if you hold it) |
| `REMOTE_POOL_ETHEREUM` | shell env | `0x…` (EVM pool address from Chainlink) |
| `REMOTE_TOKEN_ETHEREUM` | shell env | `0x…` (solAUDD token on Ethereum) |
| `REMOTE_POOL_SEPOLIA` | shell env | Same for Sepolia testnet |
| `REMOTE_TOKEN_SEPOLIA` | shell env | Same for Sepolia testnet |

---

## Env variables to add to `.env.example`

```
# ─── CCIP / solAUDD ──────────────────────────────────────────────
NEXT_PUBLIC_SOLAUDD_MINT=
NEXT_PUBLIC_SOLAUDD_DEVNET_MINT=

# ─── CCIP registration keys (set only for the registration session) ──
MINT_AUTHORITY_KEYPAIR=<path-to-solaudd-mint-authority-json>
POOL_DEPLOYER_KEYPAIR=<path-to-pool-program-deployer-wallet>   # only if you hold it
CHAINLINK_ADMIN_KEYPAIR=<path-to-chainlink-ccip-admin-json>    # only if they share it
CHAINLINK_ADMIN_PUBLIC_KEY=<0x…>                               # from ticket reply
REMOTE_POOL_ETHEREUM=0x…
REMOTE_TOKEN_ETHEREUM=0x…
REMOTE_POOL_SEPOLIA=0x…
REMOTE_TOKEN_SEPOLIA=0x…

# ─── CRE production (set AFTER Chainlink deploys & shares URLs) ────
CHAINLINK_CRE_WEBHOOK_URL=https://your-deployed-cre-workflow.chain.link/dispatch
CHAINLINK_CRE_SIGNING_SECRET=<prod-secret>
CHAINLINK_CRE_CALLBACK_SECRET=<prod-secret>
CHAINLINK_CRE_REMINDER_WEBHOOK_URL=https://your-deployed-cre-reminder.chain.link/dispatch
CHAINLINK_CRE_REMINDER_SIGNING_SECRET=<prod-secret>
CHAINLINK_CRE_REMINDER_CALLBACK_SECRET=<prod-secret>
```

---

## Chain selector reference

| Chain | Selector | Notes |
|---|---|---|
| Ethereum mainnet | `500929755` | |
| Sepolia | `1628171783` | |
| Polygon | `13235004270930276` | Add to `CFG.chains` before dry-run |
| BSC | `6450786` | |
| Base | `1650553709` | |
| Arbitrum | `1634886255` | |
| Optimism | `1869640809` | |
| Avalanche Fuji | `1476748257` | |

Source: https://docs.chain.link/ccip/supported-networks/

---

## Chainlink CCIP listing process overview

Chainlink's CCIP tokens are registered off-chain and activated through their
on-chain admin gate.  Every step below needs Chainlink's private admin key
_except_ `proposeAdministrator`, which you can pre-sign now.

```
 You (mint authority)                      Chainlink CCIP admin
 ───────────────────────────────────────────────────────────────────────
 proposeAdministrator(mint, chainlinkAdmin)
        │                                         │
        │  1 tx sig (save for ticket)              │
        ├─────────────────────────────────────────►  acceptAdminRole(mint)
        │                                          │  ← registers admin on-chain
        │                                          ▼
        │                                    createTokenPoolLT(mint)
        │                                    ← builds pool ALT
        │                                          │
        │                                          ▼
        │                               initChainRemoteConfig(mint, chain)
        │                               × N destination chains
        │                                          │
        ▼                                          ▼
    You & Chainlink collaborate on the remaining steps via their internal
    deploy pipeline.  Once their full config is in place, capsules with
    solAUDD + EVM beneficiaries will use send_ccip_from_vault from the
    Heres program (lib.rs:send_ccip_from_vault) and will succeed end-to-end.
```

---

## CRE (Chainlink Reputation Protocol) — separate queue

CRE delivery and CRE reminder are handled by **two separate Chainlink workflows**
(deployed via `cre workflow deploy`).  These are independent of CCIP and can be
fully tested locally against mock endpoints before production deploy.

### Local CRE test

```bash
# Terminal 1 — dev server
npm run dev

# Terminal 2 — test
npx tsx scripts/cre/test-local-cre.ts
```

Expected output:
```
✓ Test 1 — Mock CRE dispatch (auto-callback)
✓ Test 2 — Mock CRE reminder dispatch
✓ Test 3 — Mock CRE force-failure path
✓ Test 4 — RPC + mint resolution
```

### Production CRE deploy

Chainlink's CRE SDK (`@chainlink/cre-sdk`) wraps these workflows.  After the
devnet tests pass and Chainlink deploys production CRE workflows:

1. Chainlink deploys CRE delivery + reminder workflows → gives you webhook URLs
2. You set those URLs in your deployed Vercel env:
   - `CHAINLINK_CRE_WEBHOOK_URL` → deployed delivery URL
   - `CHAINLINK_CRE_REMINDER_WEBHOOK_URL` → deployed reminder URL
3. Confirm: `POST /api/cre/dispatch` → Chainlink CRE → `POST /api/cre/callback`

See [CRE_OPS.md](./CRE_OPS.md) for the ops handoff block.

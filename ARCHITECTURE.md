# Heres Protocol — Architecture & Integration Guide

> Detailed architecture, integration flows, and smart contract reference for the Heres Protocol.

---

## System Architecture.

```
┌──────────────────────────────────────────────────────────────────────┐
│                         User Wallet                                  │
│  Create capsule · Delegate to PER · Heartbeat · Register CRE secret │
└───────────────┬──────────────────────────┬───────────────────────────┘
                │                          │
                ▼                          ▼
┌───────────────────────────┐  ┌───────────────────────────────────────┐
│     Solana Devnet         │  │      Heres Backend (Next.js)          │
│                           │  │                                       │
│  Heres Program            │  │  /api/intent-delivery/register        │
│  ┌─────────────────────┐  │  │    → Store encrypted payload + email  │
│  │ IntentCapsule PDA    │  │  │                                       │
│  │ · owner              │  │  │  /api/intent-delivery/dispatch        │
│  │ · vault (locked SOL) │  │  │    → Trigger CRE delivery             │
│  │ · inactivity_period  │  │  │                                       │
│  │ · intent_data        │  │  │  /api/cre/callback                    │
│  │ · is_active          │  │  │    → Receive delivery confirmation    │
│  │ · executed_at        │  │  │                                       │
│  │ · mint               │  │  │  /api/cron/execute-intent             │
│  └─────────────────────┘  │  │    → Crank: scan & execute capsules   │
│                           │  │                                       │
│  FeeConfig PDA            │  │  /api/cron/reconcile-cre-delivery      │
│  · creation_fee: 0.05 SOL │  │    → Auto-dispatch pending deliveries │
│  · execution_fee: 3% BPS  │  └──────────────┬────────────────────────┘
│                           │                  │
└──────────┬────────────────┘                  │
           │                                   │
           ▼                                   ▼
┌───────────────────────────┐  ┌───────────────────────────────────────┐
│  MagicBlock ER / PER      │  │       Chainlink CRE (TEE)             │
│  (Ephemeral Rollup)       │  │                                       │
│                           │  │  ┌─────────────────────────────────┐  │
│  · Capsule delegated to   │  │  │  CRE Workflow Engine             │  │
│    ER for private          │  │  │                                 │  │
│    condition monitoring    │  │  │  1. Receive dispatch webhook    │  │
│                           │  │  │  2. Fetch decryption key from   │  │
│  · ScheduleTask crank     │  │  │     CRE Vault (TEE-secured)    │  │
│    auto-executes when     │  │  │  3. Decrypt intent statement    │  │
│    inactivity met         │  │  │     (AES-256-GCM + PBKDF2)     │  │
│                           │  │  │  4. Send email via Resend API   │  │
│  · State committed back   │  │  │  5. Callback with delivery      │  │
│    to Solana base layer   │  │  │     status                      │  │
│                           │  │  └─────────────────────────────────┘  │
└───────────────────────────┘  └───────────────────────────────────────┘
                                               │
                                               ▼
                                ┌───────────────────────────┐
                                │     Recipient Inbox        │
                                │  Decrypted intent statement │
                                │  delivered via email        │
                                └───────────────────────────┘
```

### Cross-Chain Distribution (Chainlink CCIP)

```
┌──────────────────────┐     CCIP Router      ┌──────────────────────┐
│   Solana Devnet      │ ──────────────────▶  │   EVM Destination     │
│   Capsule Vault      │   Cross-chain msg    │   (Ethereum, Base,    │
│   (SOL locked)       │   + token transfer   │    Arbitrum, etc.)    │
└──────────────────────┘                      └──────────────────────┘
```

When beneficiaries include EVM addresses, the `distribute_assets` instruction routes funds through **Chainlink CCIP** for trustless cross-chain transfer.

---

## Capsule Lifecycle Flow

```
 ┌─────────┐    ┌──────────┐    ┌───────────────┐    ┌─────────────┐    ┌──────────────┐
 │  CREATE  │───▶│ DELEGATE │───▶│    MONITOR     │───▶│   EXECUTE   │───▶│  DISTRIBUTE  │
 │          │    │ (PER/ER) │    │  (Automatic)   │    │   INTENT    │    │    ASSETS     │
 └─────────┘    └──────────┘    └───────────────┘    └──────┬──────┘    └──────┬───────┘
                                                            │                  │
      User locks SOL     Capsule delegated    Crank checks      State change:       SOL/SPL sent to
      in vault PDA       to MagicBlock ER     inactivity         is_active=false     beneficiaries
      + pays 0.05 SOL    for private          period every       executed_at=now     (3% fee deducted)
      creation fee       monitoring           1 minute                             │
                                                                                     ▼
                                                                              ┌──────────────┐
                                                                              │  CRE DELIVER  │
                                                                              │  (if enabled)  │
                                                                              └──────────────┘
                                                                              Encrypted intent
                                                                              statement sent to
                                                                              designated recipient
```

---

## Chainlink CRE Integration

Chainlink CRE (Confidential Runtime Environment) enables **encrypted intent statement delivery** — the owner's private message is encrypted client-side, stored server-side, and only decrypted inside the CRE TEE upon capsule execution.

### Registration Flow (at capsule creation)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  User writes intent statement + sets unlock code                        │
│       │                                                                 │
│       ▼                                                                 │
│  Client-side encryption (Web Crypto API)                                │
│  · AES-256-GCM with PBKDF2 key derivation                              │
│  · 120,000 iterations, random salt + IV                                 │
│  · Output: { v:1, alg:"AES-GCM", salt, iv, ciphertext }               │
│       │                                                                 │
│       ▼                                                                 │
│  POST /api/intent-delivery/register                                     │
│  · Wallet signature verification (Ed25519)                              │
│  · Store: secretRef → { encryptedPayload, owner, recipientEmail }      │
│  · Store in Upstash Redis (encrypted at rest)                           │
│       │                                                                 │
│       ▼                                                                 │
│  secretRef + secretHash written into capsule intent_data on-chain       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Delivery Flow (post-execution)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Cron: /api/cron/reconcile-cre-delivery                                 │
│       │                                                                 │
│       ▼                                                                 │
│  dispatchCreDeliveryForCapsule()                                        │
│  · Verify capsule executed (executed_at ≠ null)                         │
│  · Validate secretRef ownership + hash integrity                        │
│  · Idempotency check (prevent duplicate delivery)                       │
│       │                                                                 │
│       ▼                                                                 │
│  POST → Chainlink CRE Webhook (HMAC-SHA256 signed)                     │
│  · Payload: { capsuleAddress, owner, recipientEmail,                    │
│               secretRef, encryptedPayload }                             │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────┐                    │
│  │        Chainlink CRE TEE Vault                   │                   │
│  │                                                   │                   │
│  │  1. Retrieve decryption key (USER_KEY_{ref})     │                   │
│  │  2. Decrypt AES-256-GCM ciphertext               │                   │
│  │  3. Build email HTML with decrypted statement    │                   │
│  │  4. Send via Resend API (inside TEE)             │                   │
│  │  5. Return messageId                             │                   │
│  └───────────────────┬─────────────────────────────┘                    │
│                      │                                                   │
│                      ▼                                                   │
│  POST → /api/cre/callback (HMAC-SHA256 verified)                        │
│  · { status: "delivered", providerMessageId }                           │
│  · Update delivery ledger                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why CRE?

| Property | How Heres Uses It |
|----------|-------------------|
| **TEE Isolation** | Decryption key never leaves the CRE Vault; plaintext intent is only visible inside the TEE during email composition |
| **Webhook Trigger** | Delivery is initiated by the protocol after on-chain execution is confirmed — no manual intervention |
| **HMAC Signing** | All webhook calls and callbacks are HMAC-SHA256 signed to prevent tampering |
| **Idempotency** | Delivery ledger tracks `{capsuleAddress}:{executedAt}` to prevent duplicate sends |
| **Retry & Status** | Failed deliveries are tracked with attempt counts; reconciliation cron retries automatically |

---

## MagicBlock ER / PER Integration

### Delegation & Execution Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    Base Layer (Solana Devnet)                  │
│                                                                │
│  1. create_capsule → Capsule PDA + Vault PDA created          │
│  2. delegate_capsule → Account ownership → Delegation Program  │
│                                                                │
└────────────────────────────┬───────────────────────────────────┘
                             │ Delegation
                             ▼
┌──────────────────────────────────────────────────────────────┐
│              MagicBlock Ephemeral Rollup (ER/PER)             │
│                                                                │
│  3. schedule_execute_intent via ScheduleTask                   │
│     · Crank interval: 1 min                                    │
│     · Checks: last_activity + inactivity_period ≤ now          │
│                                                                │
│  4. execute_intent (on ER when conditions met)                 │
│     · is_active = false                                        │
│     · executed_at = current_timestamp                          │
│                                                                │
│  5. crank_undelegate (separate TX — avoids                     │
│     ExternalAccountDataModified error)                         │
│     · CPI to Magic Program for commit + undelegate             │
│                                                                │
└────────────────────────────┬───────────────────────────────────┘
                             │ State propagation
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                    Base Layer (Solana Devnet)                  │
│                                                                │
│  6. distribute_assets (on base layer)                          │
│     · Parse beneficiaries from intent_data                     │
│     · Transfer SOL/SPL from vault to each beneficiary          │
│     · Deduct 3% execution fee to platform wallet               │
│     · If EVM beneficiary → route via Chainlink CCIP            │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

### Why MagicBlock?

| Feature | How Heres Uses It |
|---------|-------------------|
| **Delegation** | Capsule PDA ownership transfers to MagicBlock delegation program; private runtime monitors conditions |
| **PER (TEE)** | Default validator runs inside TEE — inactivity checks and beneficiary data stay private |
| **ScheduleTask** | MagicBlock's built-in crank executes `execute_intent` automatically on the ER when conditions are met |
| **State Commit** | Execution results are committed back to Solana base layer via Magic Actions |
| **No Key Exposure** | Owner never shares private key; execution is permissionless once conditions are satisfied |

---

## Smart Contract Reference

### Program Information

| Item | Value |
|------|-------|
| **Program ID** | `26pDfWXnq9nm1Y5J6siwQsVfHXKxKo5vKvRMVCpqXms6` |
| **Cluster** | Solana Devnet |
| **Framework** | Anchor (Rust) |
| **Explorer** | [View on Solana Explorer](https://explorer.solana.com/address/26pDfWXnq9nm1Y5J6siwQsVfHXKxKo5vKvRMVCpqXms6?cluster=devnet) |
| **Source** | [`heres_program/programs/heres_program/src/lib.rs`](heres_program/programs/heres_program/src/lib.rs) |

### Account Structures

**IntentCapsule**
| Field | Type | Description |
|-------|------|-------------|
| `owner` | `PublicKey` | Capsule creator |
| `inactivity_period` | `i64` | Seconds before execution is allowed |
| `last_activity` | `i64` | Unix timestamp of last heartbeat |
| `intent_data` | `Vec<u8>` | JSON-encoded beneficiaries, amounts, CRE config |
| `is_active` | `bool` | Execution eligibility flag |
| `executed_at` | `Option<i64>` | Unix timestamp when executed (None until execution) |
| `mint` | `PublicKey` | Token mint (SystemProgram = SOL, else SPL) |

**FeeConfig**
| Field | Type | Description |
|-------|------|-------------|
| `fee_recipient` | `PublicKey` | Platform wallet for fee collection |
| `creation_fee` | `u64` | Flat fee for capsule creation (lamports) |
| `execution_fee_bps` | `u16` | Basis points deducted at distribution |

### PDA Seeds

| PDA | Seeds | Purpose |
|-----|-------|---------|
| `IntentCapsule` | `["intent_capsule", owner]` | Capsule state |
| `Vault` | `["capsule_vault", owner]` | Locked SOL/SPL |
| `FeeConfig` | `["fee_config"]` | Platform fee settings |
| `Permission` | `["permission", capsule]` | PER (TEE) access control |
| `Buffer` | `["buffer", capsule]` | MagicBlock state buffer |
| `DelegationRecord` | `["delegation", capsule]` | Delegation metadata |
| `DelegationMetadata` | `["delegation-metadata", capsule]` | Delegation tracking |

### Instructions

| Instruction | Description | Permission |
|-------------|-------------|------------|
| `create_capsule` | Create capsule, lock SOL in vault, pay creation fee | Owner (signs TX) |
| `update_intent` | Modify intent data (beneficiaries, amounts) | Owner only |
| `update_activity` | Refresh last_activity timestamp (heartbeat) | Owner or anyone |
| `execute_intent` | Trigger execution when inactivity period elapsed | **Permissionless** |
| `distribute_assets` | Transfer SOL/SPL to beneficiaries with fee deduction | **Permissionless** |
| `delegate_capsule` | Delegate capsule to MagicBlock ER/PER | Owner |
| `crank_undelegate` | Commit ER state + undelegate (separate from execute) | **Permissionless** |
| `schedule_execute_intent` | Schedule MagicBlock crank for auto-execution | After delegation |
| `deactivate_capsule` | Deactivate capsule | Owner only |
| `recreate_capsule` | Create new capsule after execution | Owner |

### Fee Structure

| Fee | Amount | When |
|-----|--------|------|
| **Creation Fee** | 0.05 SOL | At capsule creation |
| **Execution Fee** | 3% (300 BPS) | Deducted from vault at distribution |
| **Fee Recipient** | `Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb` | Platform treasury |

### Intent Data Schema

```json
{
  "intent": "My last will — distribute to family",
  "beneficiaries": [
    {
      "chain": "solana",
      "address": "BeneficiaryPubkey...",
      "amount": "1.5",
      "amountType": "fixed"
    },
    {
      "chain": "evm",
      "address": "0xRecipient...",
      "amount": "0.5",
      "amountType": "fixed",
      "destinationChainSelector": "16015286601757825753"
    }
  ],
  "totalAmount": "2.0",
  "inactivityDays": 30,
  "cre": {
    "enabled": true,
    "secretRef": "sec_a1b2c3...",
    "secretHash": "sha256...",
    "recipientEmailHash": "sha256...",
    "deliveryChannel": "email"
  }
}
```

---

## Deployed Addresses (Devnet)

| Component | Address |
|-----------|---------|
| **Heres Program** | `26pDfWXnq9nm1Y5J6siwQsVfHXKxKo5vKvRMVCpqXms6` |
| **Fee Config PDA** | `BUjGKZEYBETkBebtZYA5Mom3trjbvP6Enq8X1X3qRnaC` |
| **Fee Recipient** | `Covn3moA8qstPgXPgueRGMSmi94yXvuDCWTjQVBxHpzb` |
| **Delegation Program** | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| **Magic Program** | `Magic11111111111111111111111111111111111111` |
| **PER TEE Validator** | `FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA` |
| **MagicBlock ER RPC** | `https://devnet-as.magicblock.app` |

---

## Integration Summary

| Technology | Role | Integration Point |
|------------|------|-------------------|
| **Solana** | Persistent capsule state, vault, on-chain execution | Heres Program (Anchor) |
| **MagicBlock ER/PER** | Private condition monitoring, automatic crank execution | Delegation + ScheduleTask |
| **Chainlink CRE** | Encrypted intent statement delivery via TEE | Webhook dispatch + callback |
| **Chainlink CCIP** | Cross-chain asset transfer to EVM beneficiaries | `distribute_assets` instruction |
| **Helius** | RPC provider, Enhanced Transactions API, DAS (NFT) API | Frontend + Crank |
| **Upstash Redis** | CRE secret storage, delivery ledger | Server-side encrypted store |
| **Resend** | Transactional email delivery (called from inside CRE TEE) | Email API |

---

## Key Files

| File | Purpose |
|------|---------|
| `heres_program/programs/heres_program/src/lib.rs` | On-chain program source (Anchor/Rust) |
| `idl/HeresProgram.json` | Program IDL (ABI) |
| `lib/solana.ts` | Frontend Solana interactions (create, execute, delegate) |
| `lib/crank.ts` | Crank logic (scan, execute, distribute) |
| `lib/program.ts` | PDA derivation utilities |
| `lib/cre/service.ts` | CRE secret registration, dispatch, callback |
| `lib/cre/store.ts` | Redis storage for CRE secrets & delivery ledger |
| `lib/cre/auth.ts` | Signature verification for CRE requests |
| `lib/cre/solana.ts` | Capsule state fetching (base layer + ER) |
| `cre-workflow/intent-delivery/main.ts` | Chainlink CRE workflow (decrypt + email) |
| `utils/creCrypto.ts` | AES-256-GCM encryption with PBKDF2 |
| `utils/creAuth.ts` | Message signing for CRE auth |
| `utils/intent.ts` | Intent encoding/decoding |
| `constants/index.ts` | Program ID, MagicBlock, fee config |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 14, React, TypeScript, Tailwind CSS, GSAP |
| **Smart Contract** | Anchor (Rust), Solana Devnet |
| **Wallet** | Solana Wallet Adapter (Phantom, Backpack, etc.) |
| **RPC** | Helius API (Enhanced TX, DAS) |
| **Private Execution** | MagicBlock ER/PER (TEE) |
| **Intent Delivery** | Chainlink CRE (Confidential Runtime Environment) |
| **Cross-Chain** | Chainlink CCIP |
| **Storage** | Upstash Redis |
| **Email** | Resend API |
| **Encryption** | AES-256-GCM, PBKDF2 (Web Crypto API) |

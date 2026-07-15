# Heres Protocol — Architecture & Integration Guide

> Detailed architecture, integration flows, and smart contract reference for the Heres Protocol.

---

## System Architecture

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

The diagram below is a high-level product view. The current v2 program adds a draft and sealing boundary before monitoring, plus explicit account finalization after distribution and any enabled CRE delivery.

```
 ┌─────────┐    ┌──────────┐    ┌───────────────┐    ┌─────────────┐    ┌──────────────┐
 │  CREATE  │───▶│ DELEGATE │───▶│    MONITOR     │───▶│   EXECUTE   │───▶│  DISTRIBUTE  │
 │          │    │ (PER/ER) │    │  (Automatic)   │    │   INTENT    │    │    ASSETS     │
 └─────────┘    └──────────┘    └───────────────┘    └──────┬──────┘    └──────┬───────┘
                                                            │                  │
      User locks SOL     Capsule delegated    Crank checks      State change:       SOL/SPL sent to
      in vault PDA       to MagicBlock ER     inactivity         is_active=false     beneficiaries
      + pays 0.05 SOL    for private          period every       executed_at=now     in full
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
│     · No execution fee; distribute the full available balance  │
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
| **Program ID** | `sDRdG2qt6MKDB5Byfx7oqQLnZTDa32k1qM3hDSBmQUz` |
| **Cluster** | Solana Devnet |
| **Framework** | Anchor (Rust) |
| **Explorer** | [View on Solana Explorer](https://explorer.solana.com/address/sDRdG2qt6MKDB5Byfx7oqQLnZTDa32k1qM3hDSBmQUz?cluster=devnet) |
| **Source** | [`heres_program/programs/heres_program/src/lib.rs`](heres_program/programs/heres_program/src/lib.rs) |

### Account Structures

**IntentCapsule**
| Field | Type | Description |
|-------|------|-------------|
| `owner` | `PublicKey` | Capsule creator |
| `inactivity_period` | `i64` | Seconds before execution is allowed |
| `last_activity` | `i64` | Unix timestamp of last heartbeat |
| `is_active` | `bool` | False for drafts and fired capsules; true only after commitment-bound arming |
| `executed_at` | `Option<i64>` | Unix timestamp when executed (None until execution) |
| `bump` | `u8` | Switch PDA bump |
| `vault_bump` | `u8` | Paired vault PDA bump |
| `beneficiaries_bump` | `u8` | Paired private beneficiary-set PDA bump |
| `heartbeat_authority` | `PublicKey` | Relayer allowed to refresh activity |
| `version` | `u8` | Account layout version |
| `target_date` | `Option<i64>` | Optional absolute fire time |
| `reserved[0..32]` | `[u8; 32]` | Sealed inheritance configuration commitment in v2+ |

**BeneficiarySet**
| Field | Type | Description |
|-------|------|-------------|
| `owner` | `PublicKey` | Capsule creator |
| `bump` | `u8` | Beneficiary-set PDA bump |
| `version` | `u8` | Account layout version |
| `beneficiaries` | `Vec<Beneficiary>` | Up to eight fungible recipients and basis-point shares |
| `nft_assignments` | `Vec<NftAssignment>` | Up to eight NFT mint-to-recipient assignments |
| `reserved` | `[u8; 64]` | Seal flag and private commitment salt in v3+ |

**CapsuleVault**
| Field | Type | Description |
|-------|------|-------------|
| `version` | `u8` | Compact manifest for native SOL and registered token-account legs |

**FeeConfig**
| Field | Type | Description |
|-------|------|-------------|
| `fee_recipient` | `PublicKey` | Platform wallet for fee collection |
| `creation_fee` | `u64` | Flat fee for capsule creation (lamports) |

### PDA Seeds

| PDA | Seeds | Purpose |
|-----|-------|---------|
| `IntentCapsule` | `["intent_capsule", owner]` | Capsule state |
| `BeneficiarySet` | `["beneficiary_set", owner]` | Private beneficiary shares and NFT assignments |
| `Vault` | `["capsule_vault", owner]` | Locked SOL plus classic SPL and Token-2022 token accounts |
| `FeeConfig` | `["fee_config"]` | Platform fee settings |
| `Permission` | `["permission", capsule]` | PER (TEE) access control |
| `Buffer` | `["buffer", capsule]` | MagicBlock state buffer |
| `DelegationRecord` | `["delegation", capsule]` | Delegation metadata |
| `DelegationMetadata` | `["delegation-metadata", capsule]` | Delegation tracking |

### Instructions

| Instruction | Description | Permission |
|-------------|-------------|------------|
| `init_fee_config` | Initialize the singleton fee configuration | Program upgrade authority |
| `update_fee_config` | Change the configured creation fee | Fee-config authority |
| `create_capsule` | Create an inactive Switch draft, BeneficiarySet, and Vault; pay creation fee | Owner |
| `update_intent` | Set private fungible beneficiaries before sealing | Owner, routed through TEE after delegation |
| `update_nft_assignments` | Set private NFT recipients before sealing | Owner, routed through TEE after delegation |
| `seal_inheritance` | Seal beneficiary and NFT rules with a private salt and verified commitment | Owner, TEE |
| `arm_capsule` | Activate a draft Switch with the sealed configuration commitment | Owner, regular ER |
| `deposit` | Add SOL, classic SPL, or supported Token-2022 assets to the vault | Owner |
| `update_activity` | Refresh last_activity timestamp (heartbeat) | Owner or heartbeat authority |
| `execute_intent` | Trigger execution when inactivity period elapsed | **Permissionless** |
| `distribute_assets` | Transfer one fungible vault asset using the committed beneficiary shares | **Permissionless** |
| `distribute_nft` | Transfer one standard SPL NFT to its committed recipient | **Permissionless** |
| `delegate_capsule` | Delegate the liveness Switch to a regular MagicBlock ER | Owner |
| `delegate_beneficiaries` | Delegate the private beneficiary set to the permissioned TEE | Owner |
| `crank_undelegate` | Commit ER state + undelegate (separate from execute) | **Permissionless** |
| `crank_undelegate_beneficiaries` | Reveal committed private settlement data after the Switch fires | Owner before fire; permissionless after committed fire |
| `schedule_execute_intent` | Schedule MagicBlock crank for auto-execution | After delegation |
| `recover_vault` | Recover one vault asset before execution | Owner |
| `cancel_capsule` | Recover tracked assets and close an undelegated active or draft lifecycle | Owner |
| `finalize_capsule` | Close a fully settled capsule to the configured protocol fee recipient | Owner or heartbeat authority |

### Fee Structure

| Fee | Amount | When |
|-----|--------|------|
| **Creation Fee** | 0.05 SOL | At capsule creation |
| **Execution Fee** | None | Distribution sends the full available vault balance |
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
| **Heres Program** | `sDRdG2qt6MKDB5Byfx7oqQLnZTDa32k1qM3hDSBmQUz` |
| **Fee Config PDA** | `5y7eczWLCkDus2fkEgaDYRk4YyeWvNHESCgD4dcNaT53` |
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
| `idl/heres_program.json` | Program IDL (ABI) |
| `lib/inheritance-commitment.ts` | Client-side salt and settlement commitment generation |
| `lib/capsule-funding.ts` | Wallet-held fungible asset discovery for repeat deposits |
| `lib/wallet-transfer.ts` | Reviewed SOL, classic SPL, and Token-2022 wallet transfers |
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

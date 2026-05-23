# Heres - Privacy-Preserving Capsule Protocol on Solana

> **People disappear. Intent should not.**

Heres is a **privacy-preserving capsule protocol on Solana Devnet**, where assets remain delegated, conditions stay private inside **Magicblock Ephemeral Rollup (ER)** or **Private Ephemeral Rollup (PER / TEE)**, and execution happens automatically when silence becomes truth. Beyond on-chain assets, Heres introduces a **"Confidential Bridge" via Chainlink CRE (Chainlink Runtime Environment)** to securely and autonomously deliver encrypted off-chain *Intent Statements* such as passwords or recovery codes directly to your beneficiaries without any middlemen..

---

## Background

As digital asset ownership grows, a critical gap has emerged: **what happens to your crypto and your intentions when you can no longer manage them?** Traditional estate planning rarely covers bearer assets controlled by private keys. Wills and executors often lack both the technical means and legal clarity to access wallets, and leaving keys in a safe or with a lawyer creates security and privacy risks. At the same time, **confidential computing** (keeping data private during computation) has become a major focus in crypto infrastructure, enabling sensitive logic to run without exposing conditions or beneficiaries on a public ledger. 

Heres sits at the intersection: it uses **time-locked intent capsules** on Solana with **private execution** via Magicblock’s Ephemeral Rollups (ER) and Private Ephemeral Rollups (PER / TEE), so your “if I go silent” instructions are enforced automatically and privately. Furthermore, it integrates **Chainlink CRE** to extend this trustless inheritance to off-chain secrets, creating a comprehensive digital succession layer.

---

## Market Research & Trends

Our design and positioning are informed by published research and ecosystem reports from analysts and VCs.

### Digital asset inheritance & estate planning

- **Scale of the problem:** Nearly 20% of all bitcoin is estimated to be lost or stranded, often due to lost keys or owners dying without succession plans. With digital asset market cap exceeding $3T and 14–17% of U.S. adults holding crypto, unplanned wealth transfer is a growing issue.
- **Planning gaps:** Only about 24% of Americans have wills, and most wills do not address digital assets or authorize executors to access them. Cryptocurrencies are bearer assets: without proper documentation and access design, heirs cannot recover holdings.
- **Implication for Heres:** We focus on **programmatic intent**: define conditions (e.g. inactivity period, beneficiaries) once; execution is automatic when conditions are met, without relying on heirs to discover keys or courts to interpret documents.

### Decentralized confidential computing (DeCC) & TEEs

- **Investment and momentum:** Over **$1 billion** has been invested into Decentralized Confidential Computing (DeCC) projects. The space is converging around ZKPs, MPC, FHE, and **Trusted Execution Environments (TEEs)** as core primitives for private computation on public chains.
- **TEE role:** TEEs provide hardware-enforced isolation so that conditions and data can be evaluated **in use** without exposing them on-chain.
- **Implication for Heres:** We use Magicblock’s **PER (TEE)** so that inactivity checks and beneficiary logic run inside a trusted environment; only execution outcomes are committed to Solana.

### Solana ecosystem

- **Adoption and infra:** Solana has seen strong developer growth, high DEX share, and institutional interest.
- **Implication for Heres:** We build on Solana for speed, low fees, and a clear program model; we integrate Alchemy for RPC and Magicblock for private execution so capsules are both persistent on-chain and privately monitored off-chain.

---

## Overview

**Heres** is a protocol that lets you create **Intent Capsules** on Solana: you lock SOL (or define NFT intents), set an **inactivity period**, assign **beneficiaries**, and securely attach encrypted **Intent Statements** (like a master password or final letter). You delegate the capsule to Magicblock ER or PER (TEE). Your **conditions stay private** inside the rollup; when you have been inactive long enough, **execution is automatic**. The assets are distributed seamlessly, and your off-chain secrets are pushed securely via Chainlink CRE to the designated recipients. No third-party executor holds your keys; the program and the private runtime enforce your intent.

| Layer | Technology | Role |
|-------|------------|------|
| **Settlement** | **Solana Devnet** | Persistent capsule state (owner, vault, inactivity, delegation), intent data on-chain. |
| **Private Sentinel** | **Magicblock ER / PER (TEE)** | Private monitoring of conditions; triggers execution when conditions are met. |
| **Confidential Bridge** | **Chainlink CRE** | Secure off-chain delivery of encrypted Intent Statements to beneficiaries exactly where they need to go. |

---

## Problem

1. **Digital asset succession:** Crypto is bearer-asset. If you disappear, heirs often cannot access assets.
2. **Transparent conditions:** Putting “if I don’t log in for X days, send Y to Z” on a public chain exposes beneficiaries and timing to surveillance and front-running risks.
3. **The Web2 Gap:** Digital estates encompass sensitive Web2 credentials (passwords, access codes) that cannot be safely stored on public networks.
4. **Trust in executors:** Relying on a person or institution introduces counterparty risk and delay.

---

## Solution

Heres is a triple-layer orchestration framework combining:

1. **Persistent capsules on Solana** – Capsule account locks SOL in a PDA vault and holds intent data.
2. **Private execution logic** – Inactivity and beneficiary check runs inside Magicblock **PER (TEE)**, keeping conditions private off-chain until executed.
3. **Confidential delivery** – An encrypted off-chain *Intent Statement* is attached at creation. When the capsule activates, Chainlink CRE retrieves and delivers the decrypted statement directly to the beneficiary's email.
4. **Automatic execution** – When the inactivity period is met, the Magicblock Crank (or anyone) can call `execute_intent`. 

Result: **Intent remains private, execution is deterministic and automatic, and no third party ever holds your keys or plain text secrets.**

---

## Key Features

- **Zero trust executor** – No third party holds your keys; the capsule program and vault enforce transfers when conditions are met.
- **Compliant privacy** – Conditions and beneficiaries stay inside PER (TEE) / ER; only execution results are committed to Devnet.
- **Off-chain Confidential Bridge** – Utilize Chainlink's isolated CRE to deliver encrypted secrets to Web2 emails securely.
- **Permissionless execution** – After the inactivity period, any crank or user can trigger `execute_intent`.
- **PER (TEE) by default** – Delegation defaults to the TEE validator so monitoring is confidential.

---

## How It Works

1. **Create** – You define intent (e.g. total SOL, beneficiaries, inactivity period). Optional: Write an *Intent Statement* which is client-side encrypted (AES-256-GCM) and its reference stored on-chain. SOL is locked in the capsule vault.
2. **Delegate** – You delegate the capsule PDA to Magicblock ER or PER (TEE). Private runtime starts monitoring.
3. **Heartbeat (optional)** – You can call `update_activity` to refresh “last activity” and postpone execution.
4. **Execution & Delivery** 
   - When `last_activity + inactivity_period` has passed, **the crank runs automatically** (or anyone submits `execute_intent`).
   - The program deducts the execution fee and distributes SOL from the vault.
   - For attached *Intent Statements*, a reconciliation cron triggers Chainlink CRE via a signed webhook. CRE securely retrieves the decryption key inside its TEE vault, decrypts the statement, pushes it to the recipient, and callbacks delivery status to Heres.

### Automatic execution (no one needs to visit)

When conditions are met, execution and distribution happen **without the creator or beneficiaries visiting the app**. Two options:

#### 1. MagicBlock Crank (recommended — on-chain, no external cron)

When you **delegate** the capsule to PER (TEE), the system performs **two separate transactions**:
- **Step 1: Delegation** – The capsule PDA is delegated to the Ephemeral Rollup (ER) delegation program on Solana Devnet.
- **Step 2: Crank Scheduling** – A **separate transaction is sent to the ER** (via TEE RPC) to schedule automatic execution using MagicBlock's `ScheduleTask`. The crank runs `execute_intent` at intervals **on the Ephemeral Rollup**.

#### 2. Off-chain cron (fallback)

For capsules that were **not** delegated, a cron job calls `execute_intent` for eligible capsules on the Solana base layer.
- **Endpoint:** `GET` or `POST` `/api/cron/execute-intent`. 

---

## How we use Solana, Magicblock, Chainlink, and Alchemy

| Provider | How we use it | Integration Details |
|--------|----------------|---------------|
| **Solana** | The **Heres program** deployed on Devnet acts as the immutable registry. It handles capsule accounts, PDAs for the vault, execution instructions, and stores delegation parameters. | **Contract:** `heres_program` |
| **Magicblock** | We use **Ephemeral Rollups (ER)** and **Private Ephemeral Rollup (PER / TEE)** for private condition monitoring. The private runtime evaluates inactivity without exposing logic on the public ledger. | **App:** `lib/solana.ts`, `lib/tee.ts` |
| **Chainlink** | We integrate the **Chainlink Runtime Environment (CRE)** as a Confidential Bridge. It acts as an isolated TEE vault to retrieve, decrypt, and deliver our client-side encrypted *Intent Statements* to an email provider, and callbacks execution status without exposing secrets to our core backend. | **App:** `lib/cre/`, `/api/cre/dispatch` |
| **Alchemy / RPC** | We use direct Solana RPC plus Alchemy-backed RPC where configured for account fetches, dashboard indexing, and NFT inventory reads. | **App:** `config/solana.ts`, `lib/solana-data.ts` |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                             Solana Devnet                                  │
│  Heres Program (Persistent)                                                │
│  · Capsule storage: owner, locked SOL vault, inactivity_period, intent_data│
│  · CRE secretRef & secretHash committed on-chain                           │
└─────▲──────────────────────────────────────────────────────────────────────┘
      │ Magic Actions (execution result)
┌─────┴──────────────────────────────────────────────────────────────────────┐
│                       Magicblock ER / PER (TEE)                            │
│  · Private condition checks (inactivity, beneficiaries)                    │
│  · Crank monitors heartbeat & triggers execution on Devnet                 │
└─────▲──────────────────────────────────────────────────────┬───────────────┘
      │ delegate_capsule / update_activity                   │
┌─────┴────────────────────────────────────────────────┐   ┌─▼───────────────┐
│                    User Client                       │   │                 │
│  · Create capsule, payload AES-256-GCM encryption    │   │  Chainlink CRE  │
│  · delegate to PER/ER, sign transactions             ├───►  (TEE Vault)    │
└──────────────────────────────────────────────────────┘   │  Delivers Email │
                                                           └─────────────────┘
```

---

## Project Structure

```
Heres-Protocol/
├── app/                 # Next.js app (landing, create, capsules, dashboard)
├── components/          # Reusable UI components
├── config/              # Solana connection configurations
├── constants/           # Program ID, Magicblock endpoints, CRE variables
├── heres-cre/           # Chainlink CRE Delivery Workflow scripts & config
├── heres_program/       # Anchor program (Rust) smart contract
├── idl/                 # heres_program.json IDL
├── lib/                 # Core utilities (solana.ts, solana-data.ts, crank.ts, tee.ts)
│   └── cre/             # CRE crypto, auth, and dispatch logic
└── scripts/             # CRE testing & local environment scripts
```

---

## Getting Started

1. **Clone and install**
   ```bash
   git clone <repo>
   cd Heres-Protocol
   npm install
   ```

2. **Environment**  
   Create `.env.local`:
   ```env
   NEXT_PUBLIC_SOLANA_NETWORK=devnet
   NEXT_PUBLIC_SOLANA_RPC_URL=your_alchemy_or_custom_rpc_url
   NEXT_PUBLIC_PROGRAM_ID=BiAB1qZpx8kDgS5dJxKFdCJDNMagCn8xfj4afNhRZWms
   
   # Chainlink CRE Webhook settings
   CHAINLINK_CRE_WEBHOOK_URL=<deployed_cre_http_endpoint>
   ```

3. **Run**
   ```bash
   npm run dev
   ```

### Intent Statement Delivery (CRE Local Testing)

To test the CRE workflow callback locally:
```bash
npm run cre:setup:mock
npm run dev
```
Create a capsule on `/create`, provide an *Intent Statement* + Representative email, then manually trigger the reconciliation endpoint:
```http
GET /api/cron/reconcile-cre-delivery
```
You can view the delivery status mapped on the capsule detail page!

---

## License

MIT.

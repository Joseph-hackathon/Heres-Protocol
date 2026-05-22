# Heres - Privacy-Preserving Death Insurance Protocol on Solana

> **People disappear. Intent should not.**

Heres is a **Privacy-Preserving Death Insurance Protocol on Solana**, where your digital assets remain securely delegated, conditions stay completely private inside **Magicblock Private Ephemeral Rollups (PER / TEE)**, and execution happens automatically when silence becomes truth. 

Beyond on-chain assets, Heres introduces a **"Confidential Bridge" via Chainlink CRE (Chainlink Runtime Environment)** to securely and autonomously deliver encrypted off-chain *Intent Statements* (such as legacy messages, vault passwords, or recovery codes) directly to your beneficiaries without any middlemen.

---

## Background

As digital asset ownership grows, a critical gap has emerged: **what happens to your crypto and your intentions when you can no longer manage them?** Traditional estate planning rarely covers bearer assets controlled by private keys, and leaving keys with a third party creates severe security and privacy risks. 

At the same time, **confidential computing** has become a major focus in crypto infrastructure. Heres sits at this exact intersection: it acts as decentralized **death insurance**, utilizing **time-locked intent capsules** on Solana with **hardware-grade private execution** via Magicblock’s TEEs. Your “if I go silent” instructions are enforced automatically and privately, providing an institutional-grade digital succession layer.

---

## Market Research & Trends

### 1. The "Digital Graveyard" Epidemic
- **Scale of the problem:** Every year, an estimated $2.1 Billion in digital assets is permanently lost because owners pass away without a secure succession plan. Cryptocurrencies are bearer assets: without proper automated execution, heirs cannot recover holdings.
- **Implication for Heres:** We focus on **programmatic death insurance**: define conditions (e.g., heartbeat inactivity period, beneficiaries) once; execution is automatic when conditions are met, ensuring zero lost wealth.

### 2. Decentralized Confidential Computing (DeCC) & TEEs
- **TEE role:** Trusted Execution Environments (TEEs) provide hardware-enforced isolation so that conditions and data can be evaluated **in use** without exposing them on a public ledger.
- **Implication for Heres:** We use Magicblock’s **PER (TEE)** so that inactivity checks and beneficiary logic run inside a trusted enclave. Absolute privacy while alive; transparent execution only upon death or permanent absence.

### 3. The Flight to Stability in Estate Planning
- **Stablecoin Adoption:** When planning for beneficiaries who may not be crypto-native, minimizing volatility is key. 
- **Implication for Heres:** We prioritize major stablecoins (USDC, USDT, solAUDD) alongside blue-chip crypto, ensuring that the legacy left behind retains its real-world purchasing power.

---

## Overview & Asset Roadmap

**Heres** lets you create **Intent Capsules** on Solana. You deposit premium assets, set an **inactivity period**, assign **beneficiaries**, and securely attach encrypted **Intent Statements** via Chainlink. You delegate the capsule to Magicblock PER (TEE). Your **conditions stay completely private** inside the enclave; when you have been inactive long enough, **execution is automatic**.

### Supported Assets Roadmap
To ensure maximum flexibility for users, Heres Protocol is designed to support an expanding array of assets, from native tokens to wrapped assets and yield-bearing instruments.

| Phase | Asset Category | Examples | Status |
|-------|----------------|----------|--------|
| **Phase 1** | Native & Major Stablecoins | SOL, USDC, USDT, solAUDD | Live |
| **Phase 2** | Blue-chip & Liquid Staking | wBTC, ETH, JitoSOL, mSOL | Upcoming |
| **Phase 3** | Yield-Bearing & DeFi Assets | LP Tokens, Vault Shares | Roadmap |
| **Phase 4** | Real World Assets (RWA) | Tokenized Treasuries, Real Estate | Roadmap |

### Technical Architecture
| Layer | Technology | Role |
|-------|------------|------|
| **Settlement** | **Solana** | Persistent capsule state (owner, vault, inactivity, delegation), asset locking. |
| **Private Sentinel** | **Magicblock PER (TEE)** | Hardware-isolated private monitoring of conditions; triggers the Crank when conditions are met. |
| **Confidential Bridge** | **Chainlink CRE** | Secure off-chain delivery of encrypted Intent Statements to beneficiaries exactly where they need to go. |

---

## Problem

1. **Digital Asset Succession:** Crypto is a bearer-asset. If you disappear, heirs cannot access your assets without complex technical knowledge.
2. **Transparent Conditions:** Putting “if I don’t log in for X days, send Y to Z” on a public chain exposes your beneficiaries and wealth to surveillance and front-running risks.
3. **The Web2 Gap:** Estates encompass sensitive Web2 credentials (passwords, 2FA codes) that cannot be safely stored on public networks.
4. **Trust in Executors:** Relying on a person, lawyer, or centralized institution introduces severe counterparty risk, human error, and friction.

---

## Solution

Heres is an autonomous orchestration framework combining:

1. **Persistent Capsules** – A PDA vault locks your assets securely on-chain.
2. **Private Execution Logic** – Inactivity and beneficiary checks run inside Magicblock **PER (TEE)**, keeping conditions completely private off-chain until executed.
3. **Confidential Delivery (Chainlink CRE)** – An encrypted off-chain *Intent Statement* is attached at creation. When the capsule activates, Chainlink CRE retrieves and delivers the decrypted statement directly to the beneficiary's email.
4. **Protocol Insurance Fund (PIF)** – 50% of protocol revenue is directed to an on-chain SAFU fund, providing institutional-grade financial assurance against technical failures.

---

## Key Features

- **Zero Trust Executor (Code is Law):** No human intervention, lawyers, or third parties hold your keys. The smart contract acts as an uncompromising, immortal executor.
- **Enclave-level Privacy:** Beneficiary addresses, trigger conditions, and asset distributions stay completely hidden inside the TEE while you are alive. Your financial privacy is never compromised.
- **Off-chain Confidential Bridge:** Unique integration with Chainlink's isolated CRE allows us to securely decrypt and push Web2 secrets (emails, final letters) off-chain, bridging the gap between blockchain assets and real-world heirs.
- **Absolute Owner Sovereignty (Heartbeat Override):** The creator can update their "Heartbeat", modify beneficiaries, or completely revoke the capsule and withdraw funds at any time as long as they are active.
- **Multi-Asset Protection:** Agnostic asset support allowing users to mix highly volatile assets (SOL, wBTC) with stable assets (USDC, USDT) to balance the portfolio left for their beneficiaries.
- **Self-Sustaining Protocol:** Designed with a hyper-sustainable subscription model that heavily funds a Protocol Insurance Fund (PIF) to protect users from unforeseen smart-contract vulnerabilities.

---

## Business Model & Economics

Heres Protocol operates on a highly sustainable and predictable revenue model designed to scale TVP (Total Value Protected):

- **Capsule Limitation:** Users can create a maximum of **3 capsules per wallet**, ensuring premium service quality and mitigating spam.
- **Creation Fee:** A flat **$2 setup fee** per capsule.
- **Subscription Fee:** A **$2 monthly subscription fee** (payable natively in major stablecoins or SOL) to maintain the active heartbeat monitor.
- **50% SAFU Allocation:** Half of all generated revenue is strictly locked into the **Protocol Insurance Fund (PIF)** to build a massive trust moat and financially protect users.

---

## User Flow & Architecture

The following diagram illustrates the complete lifecycle of a Heres Intent Capsule, from creation to the autonomous delivery of assets and secrets upon permanent inactivity.

```mermaid
sequenceDiagram
    participant U as User (Creator)
    participant S as Solana Smart Contract
    participant T as Magicblock PER (TEE)
    participant C as Chainlink CRE
    participant B as Beneficiary
    
    %% Setup Phase
    rect rgba(59, 130, 246, 0.1)
        Note over U, S: 1. Setup & Delegation
        U->>S: Create Capsule, Deposit Assets (USDC, SOL, etc.)
        U->>S: Attach Encrypted Intent Statement (Off-chain secrets)
        U->>T: Delegate Monitoring & Conditions to TEE
    end
    
    %% Active Phase
    rect rgba(34, 197, 94, 0.1)
        Note over U, T: 2. Active Lifecycle (Heartbeat)
        loop Monthly Subscription ($2/mo)
            U->>S: Ping "I am alive" (Update Last Activity)
            S->>T: Refresh Activity Timestamp in Enclave
        end
    end
    
    %% Execution Phase
    rect rgba(239, 68, 68, 0.1)
        Note over U, B: 3. Silence & Autonomous Execution
        Note right of U: User goes permanently silent (Death/Loss)
        T->>T: Monitor Detects Inactivity > Threshold
        T->>S: Trigger Decentralized Crank
        
        par On-chain Asset Transfer
            S->>B: Distribute Locked Assets directly to Beneficiary Wallet
        and Off-chain Secret Delivery
            S->>C: Emit Execution Event
            C->>C: Decrypt Intent Statement inside Chainlink CRE Enclave
            C->>B: Deliver Email with Off-chain Secrets to Beneficiary
        end
    end

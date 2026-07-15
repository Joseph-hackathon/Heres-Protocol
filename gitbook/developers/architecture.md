---
hidden: true
---

# Architecture

Heres is a multi-layer application composed of a Next.js frontend, Solana program, automation routes, Chainlink CRE workflows, MagicBlock execution integration, and an Android mobile app.

## Repository Map

| Path              | Purpose                                                             |
| ----------------- | ------------------------------------------------------------------- |
| `app/`            | Next.js app routes, pages, and API handlers.                        |
| `components/`     | Reusable UI components.                                             |
| `config/`         | Solana and RPC configuration.                                       |
| `constants/`      | Network, fee, MagicBlock, and app constants.                        |
| `lib/`            | Solana, CRE, dashboard, mobile, and backend service logic.          |
| `utils/`          | Validation, intent parsing, CRE crypto, and signed message helpers. |
| `heres_program/`  | Anchor smart contract for capsules.                                 |
| `idl/`            | Generated program IDL files.                                        |
| `heres-cre/`      | Chainlink CRE workflows for delivery and reminders.                 |
| `mobile-android/` | Native Android MVP.                                                 |
| `scripts/`        | Setup, test, dashboard, and operational scripts.                    |
| `tests/`          | Node test suite.                                                    |

## Main Components

### Web App

The web app provides:

* Landing page.
* Capsule creation.
* My Capsule redirect.
* Capsule detail page.
* Dashboard.
* API routes for mobile, CRE, Helius, cron, and capsule data.

### Solana Program

The Anchor program manages:

* Fee configuration.
* Inactive draft creation and repeatable vault deposits.
* Private beneficiary and NFT updates before sealing.
* TEE sealing and commitment-bound Switch arming.
* Activity refresh.
* Execution.
* Multi-asset and NFT distribution.
* Vault recovery, cancellation, and settled-account finalization.
* Separate Switch and BeneficiarySet delegation helpers.

Program ID in the checked-in Rust source:

```
sDRdG2qt6MKDB5Byfx7oqQLnZTDa32k1qM3hDSBmQUz
```

Production deployments should verify the deployed program ID and IDL before publishing docs.

### MagicBlock ER/PER

MagicBlock integration supports:

* Capsule delegation.
* Private monitoring.
* Scheduled execution.
* Commit and undelegation flow.

### Chainlink CRE

CRE integration supports:

* Intent delivery registration.
* Dispatch after execution.
* HMAC protected callbacks.
* Reminder workflow support.
* Local mock CRE testing.

### Dashboard Indexing

The dashboard can use live RPC reads, Helius APIs, and optional prewarm or index jobs.

## High-Level Flow

The current lifecycle creates a draft on Solana, delegates the Switch to a regular ER and the BeneficiarySet to the authenticated TEE, seals the private configuration, and arms the Switch with its commitment. After firing, both accounts settle to Solana, every asset distributes, enabled CRE delivery completes, and finalization closes the three core accounts. The older simplified flow below omits the seal, cross-ER reveal, and finalization boundaries.

```
User Wallet
  -> Next.js create flow
  -> Heres Solana program creates capsule and vault
  -> Optional MagicBlock delegation schedules execution
  -> Inactivity window passes
  -> execute_intent marks state as executed
  -> distribute_assets sends assets to beneficiaries
  -> reconcile-cre-delivery dispatches Chainlink CRE
  -> CRE delivers encrypted statement and sends callback
```

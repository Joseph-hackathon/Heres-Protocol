# Heres Protocol Documentation

Heres is a privacy-preserving capsule protocol for Solana. It lets a wallet owner create an Intent Capsule, define beneficiaries, lock assets, attach an encrypted private message, and set an inactivity rule. If the owner does not refresh activity before the deadline, the capsule can execute and distribute the assets according to the original instructions.

Heres is designed for long-horizon digital asset recovery, inheritance, and contingency planning. The protocol combines on-chain settlement with private execution infrastructure and confidential message delivery.

## What Heres Does

- Creates on-chain capsules that hold asset distribution instructions.
- Locks SOL or configured token assets in a program-controlled vault.
- Supports beneficiary rules for Solana addresses and planned cross-chain delivery paths.
- Tracks an inactivity period based on the capsule owner.
- Lets the owner refresh activity before execution.
- Executes the capsule once the inactivity period has passed.
- Delivers an encrypted Intent Statement to a representative using Chainlink CRE.

## Core Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Settlement | Solana | Stores capsule state and settles asset movement. |
| Program | Anchor / Rust | Enforces capsule creation, activity updates, execution, and distribution. |
| Private monitoring | MagicBlock ER / PER | Monitors capsule conditions and supports automated execution. |
| Confidential delivery | Chainlink CRE | Handles encrypted Intent Statement delivery after execution. |
| Data and indexing | Helius, PostgreSQL or local store | Reads wallet activity, NFTs, dashboard metrics, and capsule history. |
| Client | Next.js, React, Tailwind | Web app for capsule creation, monitoring, and dashboard views. |
| Mobile | Android / Jetpack Compose | Native mobile MVP for monitoring and one-tap extension flows. |

## Product Flow

1. Connect a Solana wallet.
2. Create a capsule with an asset, beneficiaries, and inactivity window.
3. Add an Intent Statement and representative email.
4. Confirm the transaction and lock the selected assets.
5. Delegate or register the capsule for automation.
6. Refresh activity while the capsule should remain active.
7. After the inactivity window passes, execution marks the capsule as executed.
8. Distribution sends assets to beneficiaries and CRE delivers the encrypted statement.

## Important Notice

Heres is protocol software for digital asset automation. It is not legal, tax, custody, estate planning, or financial advice. Users should understand wallet risk, smart contract risk, network risk, and local legal requirements before relying on any automated inheritance or recovery process.

## Where To Start

- Start with [Quickstart](getting-started/quickstart.md) if you want to try the app.
- Read [Create a Capsule](user-guide/create-a-capsule.md) if you are writing user-facing help pages.
- Read [Architecture](developers/architecture.md) if you are integrating or maintaining the project.
- Read [GitBook Publishing Guide](operations/gitbook-publishing.md) to insert these docs into your website.


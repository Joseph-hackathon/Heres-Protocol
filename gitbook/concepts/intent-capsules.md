# Intent Capsules

An Intent Capsule is the central Heres protocol object.

## Capsule Account

The on-chain capsule stores:

- Owner public key.
- Inactivity period.
- Last activity timestamp.
- Intent data.
- Active flag.
- Execution timestamp.
- Vault bump.
- Optional token mint.

## Vault

The vault is a program-derived address used to hold locked assets for the capsule. For SOL capsules, the vault holds lamports. For token capsules, token accounts are used for SPL assets.

## Intent Data

Intent data is stored as serialized JSON bytes. It can include:

- Capsule type.
- Human-readable intent text.
- Total amount.
- Asset symbol.
- Asset mint.
- Beneficiaries.
- Inactivity duration.
- CRE delivery metadata.

## Beneficiaries

Beneficiaries define who receives assets after the capsule executes. A beneficiary entry may include:

- Chain type: Solana or EVM.
- Address.
- Amount.
- Fixed or percentage amount type.
- Destination chain selector.

## Lifecycle

| Phase | Description |
| --- | --- |
| Create | Owner locks assets and writes capsule state. |
| Monitor | Capsule remains active while the owner is within the inactivity window. |
| Refresh | Owner updates activity to restart the timer. |
| Execute | Capsule becomes inactive and records execution time. |
| Distribute | Vault assets are transferred to beneficiaries. |
| Deliver | CRE sends encrypted off-chain intent statement. |

## Why Execution and Distribution Are Separate

Execution is a state transition. Distribution is the asset movement step. Keeping them separate makes the system easier to automate across Solana base layer, MagicBlock ER/PER, and external delivery workflows.


# Intent Capsules

An Intent Capsule is the central Heres protocol object.

## Capsule Account

The on-chain capsule stores:

- Owner public key.
- Inactivity period.
- Last activity timestamp.
- Active flag.
- Execution timestamp.
- Vault bump.

## Vault

The vault is a program-derived address used to hold locked assets for the capsule. One vault can hold SOL plus multiple canonical associated token accounts across the classic SPL and Token-2022 programs. The list of funded assets is derived from the live vault accounts instead of a single mint stored on the capsule.

## Intent Data

The human-readable Intent Statement is registered through the confidential delivery service rather than stored in the lean on-chain capsule. Its delivery metadata can include:

- Capsule type.
- Human-readable intent text.
- Asset amount for a single-asset capsule, or a multi-asset label.
- Asset symbol.
- Asset mint.
- Beneficiaries.
- Inactivity duration.
- CRE delivery metadata.

## Beneficiaries

Beneficiaries define who receives assets after the capsule executes. A fungible beneficiary entry includes:

- Solana address.
- Percentage share in basis points.

Shares total 100 percent and apply to every fungible asset in the vault. NFT assignments map each NFT mint to one recipient separately.

## Lifecycle

| Phase | Description |
| --- | --- |
| Create | Owner locks one or more assets and writes capsule state. |
| Monitor | Capsule remains active while the owner is within the inactivity window. |
| Refresh | Owner updates activity to restart the timer. |
| Execute | Capsule becomes inactive and records execution time. |
| Distribute | Vault assets are transferred to beneficiaries. |
| Deliver | CRE sends encrypted off-chain intent statement. |

## Why Execution and Distribution Are Separate

Execution is a state transition. Distribution is the asset movement step. Keeping them separate makes the system easier to automate across Solana base layer, MagicBlock ER/PER, and external delivery workflows.

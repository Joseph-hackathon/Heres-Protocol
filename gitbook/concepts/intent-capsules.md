# Intent Capsules

An Intent Capsule is the central Heres protocol object.

## Capsule Account

The on-chain capsule stores:

- Owner public key.
- Inactivity period.
- Last activity timestamp.
- Active flag.
- Execution timestamp.
- Vault and beneficiary-set bumps.
- Heartbeat authority.
- Optional fixed target date.
- Sealed inheritance configuration commitment.

The private `BeneficiarySet` is a separate account. It stores fungible beneficiary shares and NFT assignments inside the TEE while the capsule is live, then returns to Solana for settlement only after the Switch fires.

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
| Draft | Owner creates the inactive Switch, private BeneficiarySet, and Vault, then deposits one or more assets. |
| Seal | The TEE stores the beneficiary and NFT rules, adds a private salt, and verifies their commitment. |
| Arm | The regular ER activates the Switch with the same commitment and schedules execution. |
| Monitor | Capsule remains active while the owner is within the inactivity window. |
| Refresh | Owner updates activity to restart the timer. |
| Execute | Capsule becomes inactive and records execution time. |
| Reveal | The fired Switch and private BeneficiarySet settle back to Solana. |
| Distribute | Every vault asset is transferred according to the committed rules. |
| Deliver | CRE sends encrypted off-chain intent statement. |
| Finalize | After all settlement work completes, the three core capsule accounts close and their rent goes to the configured protocol fee recipient. |

## Why Execution and Distribution Are Separate

Execution is a state transition. Distribution is the asset movement step. Keeping them separate makes the system easier to automate across Solana base layer, MagicBlock ER/PER, and external delivery workflows.

Finalization is separate for the same reason. It cannot close a current tracked vault until every registered asset leg is empty, and enabled Intent Statement delivery must complete before the application or crank finalizes the lifecycle.

# Manage a Capsule

The capsule detail page is the control center for a created capsule.

## Capsule Statuses

| Status | Meaning |
| --- | --- |
| Active | The capsule is live and has not reached execution state. |
| Expired | The inactivity deadline has passed and the capsule is eligible for execution. |
| Executed | The execution instruction has marked the capsule as executed. |
| Inactive | The capsule is no longer active but may not have completed the full distribution lifecycle. |

## View Capsule Details

The detail page may show:

- Capsule address.
- Owner wallet.
- Vault address.
- Asset type and amount.
- Beneficiaries.
- Last activity time.
- Inactivity deadline.
- Execution timestamp.
- CRE delivery status.
- Solana Explorer links.

## Refresh Activity

Refreshing activity restarts the inactivity countdown. This is the main way for an owner to show that the capsule should remain active.

Only refresh activity when you want to delay execution.

## Execute Intent

After the inactivity period has passed, the capsule can be executed. Execution changes capsule state. It does not need to be performed by the original owner.

Execution sets:

- `is_active` to `false`.
- `executed_at` to the current timestamp.

## Distribute Assets

After execution, distribution transfers the full available vault balance to the configured beneficiaries. The current program does not deduct an execution fee.

In the current protocol design, execution and distribution are separate operations. This lets private execution and base-layer settlement coordinate safely.

## Undelegate Capsule

If a capsule was delegated to MagicBlock ER/PER, undelegation commits state back to the base layer. Some flows require undelegation after execution before distribution.

## CRE Delivery Status

If the capsule includes an Intent Statement, the detail page can show delivery state:

- Pending.
- Dispatched.
- Delivered.
- Failed.

Delivery status is checked with wallet-signed requests where required.

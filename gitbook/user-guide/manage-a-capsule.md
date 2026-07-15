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
- Live vault inventory, including withdrawable SOL and each classic SPL or Token-2022 mint.
- Beneficiaries.
- Last activity time.
- Inactivity deadline.
- Execution timestamp.
- CRE delivery status.
- Solana Explorer links.

## Refresh Activity

Refreshing activity restarts the inactivity countdown. This is the main way for an owner to show that the capsule should remain active.

Only refresh activity when you want to delay execution.

## Add or Withdraw Funds

While the capsule is active, the owner can add SOL or any supported fungible mint held in the connected wallet. Adding funds is not limited to the assets selected during creation.

The owner can also withdraw one vault asset at a time or withdraw all assets. Token withdrawals create the owner's canonical associated token account when it no longer exists. These actions change vault balances without changing the beneficiary split.

## Execute Intent

After the inactivity period has passed, the capsule can be executed. Execution changes capsule state. It does not need to be performed by the original owner.

Execution sets:

- `is_active` to `false`.
- `executed_at` to the current timestamp.

## Distribute Assets

After execution, distribution transfers the full available vault balance to the configured beneficiaries. Each fungible mint uses the same configured percentage split. The current program does not deduct an execution fee.

Multi-asset distribution runs as one confirmed transaction per asset, with SPL and Token-2022 legs before the final SOL leg. If a later wallet approval fails, already confirmed legs remain complete. Refresh and retry to process only the assets still in the vault.

In the current protocol design, execution and distribution are separate operations. This lets private execution and base-layer settlement coordinate safely.

## Undelegate Capsule

If a capsule was delegated to MagicBlock ER/PER, undelegation commits state back to the base layer. Some flows require undelegation after execution before distribution.

Base-layer actions stay disabled until both the capsule switch and private beneficiary set are settled on Solana. If only one account has settled, use **Finish Undelegation** and refresh the page.

## Cancel a Capsule

An owner can cancel an active capsule after both lifecycle accounts are undelegated. Cancellation recovers every canonical vault token account, returns SOL and account rent to the owner, and then closes the capsule accounts. If an earlier recovery confirms and a later transaction fails, refresh and retry cancellation to process the remaining accounts.

## CRE Delivery Status

If the capsule includes an Intent Statement, the detail page can show delivery state:

- Pending.
- Dispatched.
- Delivered.
- Failed.

Delivery status is checked with wallet-signed requests where required.

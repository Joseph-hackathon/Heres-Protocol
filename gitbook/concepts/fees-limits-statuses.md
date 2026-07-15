# Fees, Limits, and Statuses

## Fees

Default repository configuration:

| Fee | Default | Purpose |
| --- | --- | --- |
| Creation fee | 0.05 SOL | Paid when creating a capsule. |
| Execution fee | None | Distribution sends the full available vault balance. |

The creation fee is controlled by the on-chain fee configuration. Production deployments should display its current value before every signing step.

## Modification Limit

The web app retains a local modification counter for legacy flows. For new capsules, the stronger on-chain boundary is the inheritance seal: beneficiary shares and NFT assignments can be written while the capsule is a draft, but the program rejects every edit after sealing.

## Inactivity Period

The inactivity period controls when a capsule becomes eligible for execution. Defaults are configured in the app:

| Setting | Default |
| --- | --- |
| Inactivity period | 365 days |
| Delay days | 30 days |

Devnet builds may expose minute-based testing to make demos easier.

## Capsule Statuses

| Status | Meaning |
| --- | --- |
| Draft | Capsule accounts exist, but commitment-bound arming did not complete. The capsule cannot execute. |
| Active | Capsule can still be refreshed by the owner. |
| Expired | Inactivity deadline has passed. |
| Executed | Execution timestamp is set. |

A finalized capsule has no live status account because finalization closes the Switch, BeneficiarySet, and Vault. The wallet can then create a fresh lifecycle.

## Delivery Statuses

| Status | Meaning |
| --- | --- |
| Pending | Delivery has not yet completed. |
| Dispatched | Delivery request was sent to CRE. |
| Delivered | CRE reported successful message delivery. |
| Failed | Delivery failed and may need retry or operator review. |

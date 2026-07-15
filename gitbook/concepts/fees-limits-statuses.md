# Fees, Limits, and Statuses

## Fees

Default repository configuration:

| Fee | Default | Purpose |
| --- | --- | --- |
| Creation fee | 0.05 SOL | Paid when creating a capsule. |
| Execution fee | None | Distribution sends the full available vault balance. |

The creation fee is controlled by the on-chain fee configuration. Production deployments should display its current value before every signing step.

## Modification Limit

The web app tracks a default maximum of 3 capsule modifications per wallet in local state. Production deployments should clarify whether modification limits are enforced only by the client or also by protocol logic.

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
| Active | Capsule can still be refreshed by the owner. |
| Expired | Inactivity deadline has passed. |
| Executed | Execution timestamp is set. |
| Inactive | Capsule is not active. |

## Delivery Statuses

| Status | Meaning |
| --- | --- |
| Pending | Delivery has not yet completed. |
| Dispatched | Delivery request was sent to CRE. |
| Delivered | CRE reported successful message delivery. |
| Failed | Delivery failed and may need retry or operator review. |

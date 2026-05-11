# Automation and Cron Jobs

Heres uses automation to keep capsules moving through the lifecycle without requiring the owner to manually return at execution time.

## Automation Paths

| Path | Purpose |
| --- | --- |
| MagicBlock scheduled execution | Preferred private execution flow for delegated capsules. |
| Cron execution | Fallback or operational execution for eligible capsules. |
| CRE reconciliation | Delivers encrypted statements after execution. |
| Dashboard indexing | Keeps dashboard data fast and current. |

## Execute Intent Cron

Route:

```text
/api/cron/execute-intent
```

Purpose:

- Scan registered or discoverable capsules.
- Identify capsules past inactivity deadline.
- Submit execution transaction.

## Undelegate Capsules Cron

Route:

```text
/api/cron/undelegate-capsules
```

Purpose:

- Commit state from MagicBlock ER/PER back to the Solana base layer.
- Prepare capsules for distribution.

## CRE Delivery Reconciliation

Route:

```text
/api/cron/reconcile-cre-delivery
```

Purpose:

- Find executed capsules with pending Intent Statement delivery.
- Dispatch delivery to Chainlink CRE.
- Avoid duplicate sends with idempotency keys.
- Retry failed delivery attempts where allowed.

## CRE Reminder Reconciliation

Route:

```text
/api/cron/reconcile-cre-reminders
```

Purpose:

- Coordinate reminder delivery workflows before execution windows.
- Track callback state from CRE reminder workflows.

## Security

Automation endpoints should be protected by:

- `CRON_SECRET`.
- Hosting provider scheduled job auth.
- Network restrictions where possible.
- Rate limits and structured logging.

Do not expose automation secrets to browser code or mobile clients.

## Observability

Production automation should log:

- Capsule address.
- Owner address.
- Action attempted.
- Transaction signature.
- CRE idempotency key.
- Delivery status.
- Error message and retry count.


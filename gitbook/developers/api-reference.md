# API Reference

This page lists the main application API routes. Response shapes can evolve, so confirm exact payloads in the route handlers before building a third-party integration.

## Capsule Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/capsules/list` | List indexed capsules. |
| `GET` | `/api/capsules/summary` | Return aggregate capsule summary. |
| `GET` | `/api/capsules/fee-config` | Read fee configuration. |
| `GET` | `/api/capsules/[id]` | Read a specific capsule. |
| `GET`/`POST` | `/api/capsule-registry` | Registry helper for capsule owners and automation. |

## Dashboard Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard` | Dashboard snapshot. |
| `GET`/`POST` | `/api/internal/dashboard-index` | Internal dashboard indexing. |
| `GET`/`POST` | `/api/internal/dashboard-prewarm` | Prewarm dashboard data. |

## Helius Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/helius/nfts` | Fetch wallet NFTs. |
| `POST` | `/api/helius/webhook` | Receive Helius webhook events. |

## Intent Delivery Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/intent-delivery/register` | Register encrypted Intent Statement delivery metadata. |
| `GET` | `/api/intent-delivery/status` | Check delivery status. |
| `POST` | `/api/intent-delivery/dispatch` | Dispatch an intent delivery. |
| `POST` | `/api/intent-reminder/register` | Register reminder delivery. |
| `GET` | `/api/intent-reminder/status` | Check reminder status. |

## CRE Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/cre/dispatch` | Dispatch Chainlink CRE delivery. |
| `POST` | `/api/cre/callback` | Receive CRE delivery callback. |
| `POST` | `/api/cre/reminder-dispatch` | Dispatch reminder workflow. |
| `POST` | `/api/cre/reminder-callback` | Receive reminder callback. |

## Cron Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET`/`POST` | `/api/cron/execute-intent` | Find eligible capsules and execute. |
| `GET`/`POST` | `/api/cron/undelegate-capsules` | Commit or undelegate delegated capsules. |
| `GET`/`POST` | `/api/cron/reconcile-cre-delivery` | Dispatch pending CRE deliveries after execution. |
| `GET`/`POST` | `/api/cron/reconcile-cre-reminders` | Reconcile reminder workflow state. |

## Mobile Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/mobile/dashboard` | Mobile dashboard data. |
| `GET` | `/api/mobile/capsules` | List wallet capsules. |
| `GET` | `/api/mobile/capsules/[address]` | Read one capsule. |
| `GET` | `/api/mobile/activity-score` | Activity score for a wallet. |
| `POST` | `/api/mobile/extend-preview` | Build extension preview. |
| `POST` | `/api/mobile/tx/create-capsule` | Build unsigned create capsule transaction. |
| `POST` | `/api/mobile/tx/update-activity` | Build unsigned update activity transaction. |

## Mock Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/mock/cre` | Local mock CRE delivery endpoint. |
| `POST` | `/api/mock/cre-reminder` | Local mock CRE reminder endpoint. |

## Authentication Notes

Protected routes may require one or more of:

- Wallet signature.
- `x-cre-signature` HMAC header.
- Cron secret.
- Webhook auth token.
- Internal deployment network restrictions.

Never expose cron or dispatch secrets in client-side code.


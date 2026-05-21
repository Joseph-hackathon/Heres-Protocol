# CRE Ops Handoff — Chainlink

## What this is

Heres uses **two Chainlink CRE workflows** (deployed by Chainlink's `cre` CLI):

| Workflow | Direction | Webhook |
|---|---|---|
| Delivery  | Heres → Chainlink CRE | `POST /api/cre/dispatch` → `CHAINLINK_CRE_WEBHOOK_URL` |
| Reminder  | Heres → Chainlink CRE | `POST /api/cre/reminder-dispatch` → `CHAINLINK_CRE_REMINDER_WEBHOOK_URL` |

## Our callback endpoints (Chainlink TEE calls these)

| Callback | URL your_vite/vercel_deployment | Auth |
|---|---|---|
| Delivery callback | `https://<Vercel Domain>/api/cre/callback` | `x-cre-signature` HMAC header |
| Reminder callback | `https://<Vercel Domain>/api/cre/reminder-callback` | `x-cre-signature` HMAC header |

## Env vars you control in our deployment

```bash
# Delivery
CHAINLINK_CRE_WEBHOOK_URL=https://<chainlink-deployed-url>/dispatch
CHAINLINK_CRE_SIGNING_SECRET=<strong-secret-here>
CHAINLINK_CRE_CALLBACK_SECRET=<strong-secret-or-empty>

# Reminder
CHAINLINK_CRE_REMINDER_WEBHOOK_URL=https://<chainlink-deployed-url>/reminder/dispatch
CHAINLINK_CRE_REMINDER_SIGNING_SECRET=<strong-secret-here>
CHAINLINK_CRE_REMINDER_CALLBACK_SECRET=<strong-secret-or-empty>
```

## Local DEV defaults (only on localhost)

```bash
CHAINLINK_CRE_WEBHOOK_URL=http://127.0.0.1:3000/api/mock/cre
CHAINLINK_CRE_SIGNING_SECRET=dev-cre-signing-secret
CHAINLINK_CRE_CALLBACK_SECRET=dev-cre-callback-secret
CHAINLINK_CRE_REMINDER_WEBHOOK_URL=http://127.0.0.1:3000/api/mock/cre-reminder
MOCK_CRE_AUTO_CALLBACK=true          # mock auto-callbacks back to /api/cre/callback
MOCK_CRE_CALLBACK_BASE_URL=http://127.0.0.1:3000
```

## Request format Chainlink's CRE TEE dispatches

### Delivery dispatch (Heres → Chainlink → CRE TEE → Heres callback)

```json
POST ${CHAINLINK_CRE_WEBHOOK_URL}
{
  "idempotencyKey":       "capsule-<address>-exec-<timestamp>",
  "capsuleAddress":       "<PDA of Intent Capsule>",
  "owner":                "<wallet base58>",
  "executedAt":           "<ISO-8601>",
  "recipientEmail":       "representative@example.com",
  "recipientEmailHash":   "0x<hash>",
  "encryptedPayload":     "<base64 of CRE-encrypted intent>",
  "secretRef":            "<Chainlink secret object reference>",
  "secretHash":           "<sha256 hex>",
  "encryptedPayloadHash": "<sha256 hex of ciphertext>",
  "signature":            "<base64 signed message>",
  "timestamp":            "<millis>",
  "authToken":            "<optional wallet auth>"
}
```

### Reminder dispatch

```json
POST ${CHAINLINK_CRE_REMINDER_WEBHOOK_URL}
{
  "reminderId":           "<unique reminder ID>",
  "idempotencyKey":       "reminder-<capsuleAddress>-<timestamp>",
  "capsuleAddress":       "<PDA>",
  "owner":                "<wallet base58>",
  "recipientEmail":       "representative@example.com",
  "assetSymbol":          "SOL|BTC|ETH|MSOL|USDC|SOLAUDD",
  "assetLabel":           "display name",
  "totalAmount":          "1.5",
  "beneficiaryCount":     2,
  "inactivityLabel":      "30 days",
  "delayDays":            30,
  "createdAt":            <millis>,
  "scheduledAt":          <millis>,
  "reminderIntervalDays": 7,
  "signature":            "<base64>",
  "timestamp":            <millis>,
  "authToken":            "<optional>"
}
```

## Our callback payload (Chainlink → Heres on completion)

### Delivery callback (`POST /api/cre/callback`)

```json
{
  "status":        "delivered",            // or "failed"
  "idempotencyKey":"capsule-...",
  "capsuleAddress":"<PDA>",
  "executedAt":    "<ISO-8601>",
  "providerMessageId": "cre-<id>",
  "error":         "<optional error>"
}
```

### Reminder callback (`POST /api/cre/reminder-callback`)

```json
{
  "status":         "delivered",
  "idempotencyKey": "reminder-...",
  "reminderId":     "<reminder ID>",
  "providerMessageId": "cre-reminder-<id>",
  "error":          "<optional error>"
}
```

## Signature verification

Our callback API verifies:

```
x-cre-signature = base64encode( HMAC-SHA256(CHAINLINK_CRE_SIGNING_SECRET, body) )
```

If `CHAINLINK_CRE_SIGNING_SECRET` is empty, sig verification is skipped locally
but should be enforced in production.

## Pre-prod checklist before pointing at production URLs

- [ ] Chainlink CRE workflows are deployed (staging)
- [ ] Staging webhook URLs copied from Chainlink
- [ ] `CHAINLINK_CRE_*_SIGNING_SECRET` values match what Chainlink uses
- [ ] Heres dev server is running
- [ ] `npm run cre:setup` was run to seed the secret store
- [ ] Test dispatch and callback succeed (check `CRE_STORE_PATH` JSON store)
- [ ] Transition to production webhook URLs
- [ ] Re-test with production secrets
- [ ] Monitor `helius_webhook_logs` for failed CRE events

# Heres CRE Reminder Workflow

This workflow receives Heres reminder dispatch payloads over HTTP and posts periodic reminder delivery status back to Heres.

## What it does

1. Trigger: HTTP payload from Heres (`/api/cre/reminder-dispatch` or `/api/cron/reconcile-cre-reminders`)
2. Validate required reminder fields (`reminderId`, `idempotencyKey`, `capsuleAddress`, `scheduledAt`, etc.)
3. Post callback to Heres (`/api/cre/reminder-callback`) with:
   - `status: delivered` (or `failed` if `forceFailure=true`)
   - `idempotencyKey`, `capsuleAddress`, `scheduledAt`, `providerMessageId`

## Config files

- `config.staging.json`
- `config.production.json`

Important keys:

- `callbackUrl`: Heres reminder callback endpoint
- `callbackAuthHeader`: Optional static Authorization header
- `providerMessagePrefix`: Prefix for generated `providerMessageId`
- `forceFailure`: Toggle to simulate failure

## Local simulation

From project root (`/Users/yong/snorlax/Heres-Protocol/heres-cre`):

```bash
bun install --cwd ./cre-reminder
cre workflow simulate cre-reminder \
  --non-interactive \
  --trigger-index 0 \
  --http-payload @/Users/yong/snorlax/Heres-Protocol/heres-cre/cre-reminder/test-dispatch.json \
  --target staging-settings
```

## Heres app env mapping

Set in `/Users/yong/snorlax/Heres-Protocol/.env.local`:

- `CHAINLINK_CRE_REMINDER_WEBHOOK_URL=<deployed_cre_http_endpoint>`
- `CHAINLINK_CRE_REMINDER_SIGNING_SECRET=<optional dispatch signing secret>`
- `CHAINLINK_CRE_REMINDER_CALLBACK_SECRET=` (leave empty unless workflow is signing callback body)

If `CHAINLINK_CRE_REMINDER_CALLBACK_SECRET` is set in Heres app, reminder callback API will reject unsigned callbacks with `Invalid callback signature`.

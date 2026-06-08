# Crank / Automation Runbook

Internal setup and operations for the Heres autonomous crank, the server-side
job that fires the dead-man's-switch (execute + distribute) with no human action.
This is a team deployment guide, not user docs. For the protocol overview see
`README.md` and `ARCHITECTURE.md`.

## TL;DR deploy checklist

- [ ] Persistent registry backend configured (Upstash Redis OR Postgres). The
      local file registry is dev-only and will NOT work in production.
- [ ] `CRON_SECRET` set.
- [ ] `CRANK_WALLET_PRIVATE_KEY` set, and the wallet funded with SOL for gas.
- [ ] Schedule wired (Vercel cron in `vercel.json`, or an external scheduler).
- [ ] Smoke test: one authenticated `POST` returns `200` with `"ok": true`.

If only one thing is wrong in prod it is almost always the registry backend (see
Troubleshooting: "nothing ever fires").

## What the crank does

A scheduler calls one route, `/api/cron/execute-intent`, on an interval. Each
call sweeps the registered capsules and advances every due one by a single
idempotent step:

```
delegated  + active   + elapsed      -> execute on ER (MagicBlock backstop)
delegated  + executed                -> undelegate (return to base layer)
!delegated + active   + elapsed      -> execute on base, distribute, unregister
!delegated + executed + !distributed -> distribute, unregister
active     + !elapsed                -> record true due-time, skip until due
```

Default arm flow is base-only (Model A). The MagicBlock ER legs are gated behind
`NEXT_PUBLIC_DELEGATE_ON_CREATE` and are OFF by default. On-chain guards make
every step safe to repeat, so a half-finished or missed tick self-heals next run.

Route source: `app/api/cron/execute-intent/route.ts` -> `lib/crank.ts`.
Registry source: `lib/capsule-registry.ts`.

## Required environment

| Variable | Required | Notes |
| --- | --- | --- |
| `CRON_SECRET` | Yes | Shared secret. Sent as `Authorization: Bearer <CRON_SECRET>`. Route returns `503` if unset, `401` if the token mismatches. |
| `CRANK_WALLET_PRIVATE_KEY` | Yes | Crank wallet key. Accepts base58, base64, or a JSON array of 64 bytes. Fee payer for every tx. |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | One backend required | Redis registry backend (first preference). |
| `DATABASE_URL` | One backend required | Postgres registry backend (used if Redis is not set). |
| `SOLANA_RPC_URL` | Recommended | Server-side RPC. Public devnet/mainnet endpoints rate-limit; use Helius or similar. |
| `APP_BASE_URL` | If external cron | Public base URL the external scheduler calls. |

Full variable reference: `gitbook/developers/environment-variables.md`.

## Registry backend (the critical piece)

The crank finds capsules through an owner registry that carries a due-time index,
so each tick fetches only the capsules that can fire. Backend is chosen in order:

1. Upstash Redis (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) - a
   sorted set scored by `last_activity + inactivity_period`.
2. Postgres (`DATABASE_URL`) - the `capsule_owner_registry` table with a `due_at`
   column. Schema, including the column and its index, is created automatically
   on first query; no manual migration.
3. Local file under `.data/` - DEV ONLY.

Production must use Redis or Postgres. On a serverless host (Vercel) the file
backend lives in a per-invocation temp directory that does not persist, so the
registry would be empty on every tick and nothing would ever fire. If the
dashboard already uses Postgres, the crank reuses the same `DATABASE_URL` with no
new infra.

Both persistent backends are proven end to end on devnet (file and Postgres,
18/18 assertions in `scripts/e2e-m2-due-index.mjs`).

## Crank wallet

`CRANK_WALLET_PRIVATE_KEY` is the fee payer for every `execute_intent` and
`distribute_assets` transaction, and it also pays the rent to create a
beneficiary token account when one does not already exist. Keep it funded with
SOL; if it runs dry, ticks fail with insufficient-lamports errors and capsules
stall until it is topped up. Never commit the key; it stays in the host's env /
secret store, not in the repo.

## Scheduling and hosting

### Vercel cron (current default)

`vercel.json` registers a daily trigger:

```json
{ "crons": [ { "path": "/api/cron/execute-intent", "schedule": "0 0 * * *" } ] }
```

Vercel injects the `Authorization: Bearer <CRON_SECRET>` header automatically when
`CRON_SECRET` is set, so no extra auth wiring is needed. Plan limits apply: Hobby
allows roughly one run per day; Pro allows finer schedules. Change `schedule`
(standard cron syntax, UTC) to run more often on a plan that permits it.

### External scheduler (self-host or finer cadence)

`vercel.json` crons only run on Vercel. On any other host, or to run more often
than the plan allows, point an external scheduler (server crontab, GitHub Actions
schedule, Upstash QStash, hosted cron service) at the route:

```bash
curl -s -X POST "$APP_BASE_URL/api/cron/execute-intent" \
  -H "Authorization: Bearer $CRON_SECRET"
```

### Cadence note

A daily schedule means up to ~24h between a capsule becoming eligible and firing.
The base path runs execute -> distribute -> cleanup in one tick, so a single daily
run takes an eligible capsule all the way to paid out. Shorten the schedule if you
need tighter latency. Cost scales with the number of DUE capsules per tick, not
total registered, so the schedule does not need to change as the registry grows.

## Verify a deployment

```bash
curl -s -X POST "$APP_BASE_URL/api/cron/execute-intent" \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

Expected: HTTP `200` and a body like

```json
{ "ok": true, "dueSelected": 0, "fullScan": false, "scanned": 0,
  "executedBase": 0, "distributed": 0, "errors": [], "cre": { ... } }
```

Field meanings: `dueSelected` = capsules the index returned this tick;
`fullScan` = `true` only if the index read failed and it fell back to scanning
the whole registry; `scanned` = accounts actually fetched; `executedBase` /
`executedEr` / `undelegated` / `distributed` = actions taken; `errors` = per-capsule
failures (a non-empty list flips `ok` to `false`).

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Nothing ever fires; `dueSelected` is 0 even with due capsules | File registry on a serverless host (no persistent backend) | Set `UPSTASH_*` or `DATABASE_URL` |
| `401 Unauthorized` | Bearer token does not match `CRON_SECRET` | Align the scheduler's token with the env value |
| `503` | `CRON_SECRET` not set on the host | Set it |
| `errors[]` mentions insufficient lamports | Crank wallet out of gas | Fund `CRANK_WALLET_PRIVATE_KEY` |
| Capsule executed but not paid | Distribute failed mid-tick | Next tick recovers it (idempotent); check crank balance and RPC health |
| `fullScan: true` every tick | Index backend read failing | Check Redis/Postgres connectivity; still correct, just more RPC |
| `500` with a single error message | Pipeline threw before per-capsule loop (e.g. RPC/backend down) | Check the error string and backend/RPC health |

## Local testing

Run a dev server (`next dev`) with `CRON_SECRET` set, then:

- `scripts/e2e-create-test-capsule.mjs` - create one base-only test capsule
  (funded ephemeral owner, beneficiary = crank wallet, short inactivity).
- `scripts/e2e-m2-due-index.mjs` - full proof: creates fast + cold capsules,
  registers them, fires the real cron route across ticks, and asserts the index
  selects only due capsules and re-admits a cold one once it elapses. Uses the
  file registry by default; set `DATABASE_URL` to run and inspect against Postgres.

To exercise the Postgres backend locally:

```bash
docker run -d --name heres-pg -e POSTGRES_USER=heres -e POSTGRES_PASSWORD=heres \
  -e POSTGRES_DB=heres -p 5433:5432 postgres:16-alpine
# start dev server with DATABASE_URL + CRON_SECRET, then:
CRON_SECRET=... DATABASE_URL=postgres://heres:heres@localhost:5433/heres \
  node scripts/e2e-m2-due-index.mjs
```

## Status / internal notes

- Proven on devnet: M1 (base execute -> distribute -> cleanup, autonomous,
  idempotent) and M2 (due-time index + batched reads), on both the file and
  Postgres backends.
- Base-only (Model A) is the default and the proven path.
- ER path (`NEXT_PUBLIC_DELEGATE_ON_CREATE=true`) is implemented but code-only;
  the ER -> base -> distribute multi-tick flow has not been live-tested.
- EVM-heir leg (`reconcileCreDeliveries` / CCIP) runs in the same route but was
  not exercised in the crank proofs (no EVM beneficiaries present).
- Deferred: permissionless keeper fee (`msg.sender` incentive in
  `distribute_assets`); needs a contract change.

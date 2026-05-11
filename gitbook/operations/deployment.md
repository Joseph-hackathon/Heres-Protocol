# Deployment

This guide outlines production deployment considerations for Heres.

## Deployment Checklist

Before production:

- Deploy the Anchor program to the target Solana cluster.
- Verify the program ID in `NEXT_PUBLIC_PROGRAM_ID`.
- Publish matching IDL files.
- Initialize fee configuration.
- Configure platform fee recipient.
- Configure RPC and fallback RPC providers.
- Configure Helius API keys and webhooks.
- Configure Chainlink CRE workflows and secrets.
- Configure MagicBlock ER/PER endpoints.
- Configure cron jobs.
- Configure persistent storage.
- Run end-to-end capsule lifecycle tests.
- Run security review for keys, callbacks, and smart contract authority.

## Web App Deployment

The app is a Next.js project. A typical deployment target is Vercel.

Build command:

```bash
npm run build
```

Start command:

```bash
npm run start
```

## Environment

Set production environment variables in the hosting provider. Do not rely on local `.env.local`.

Required production categories:

- Solana network and program ID.
- RPC providers.
- Helius API key.
- Platform fee recipient.
- CRE webhook URL and secrets.
- Cron secret.
- Database or Redis credentials.
- App base URL.

## Storage

For demos, the local `.data` store can be useful. For production, use managed storage:

- PostgreSQL for durable dashboard and capsule indexing.
- Upstash Redis for delivery or temporary workflow state.
- Managed logs for cron and delivery failures.

## Cron Jobs

Configure scheduled calls for:

- Execute eligible capsules.
- Undelegate committed capsules.
- Reconcile CRE delivery.
- Reconcile CRE reminders.
- Dashboard prewarm or indexing, if enabled.

Protect each route with `CRON_SECRET` or deployment-level authentication.

## Post-Deployment Verification

After deployment:

1. Connect a Devnet or staging wallet.
2. Create a small test capsule.
3. Confirm vault funding.
4. Confirm dashboard indexing.
5. Trigger or wait for execution eligibility.
6. Execute the capsule.
7. Distribute assets.
8. Confirm CRE delivery status.
9. Check logs for failed callbacks or retries.


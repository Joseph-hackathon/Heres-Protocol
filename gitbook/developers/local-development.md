# Local Development

## Requirements

- Node.js 20 or newer recommended.
- npm.
- Solana wallet for browser testing.
- Devnet SOL.
- Optional: Anchor and Rust for smart contract work.
- Optional: Android Studio for mobile development.

## Install

```bash
npm install
```

## Configure Environment

Copy the example environment file:

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Then fill in values for RPC, Helius, program ID, CRE secrets, and automation secrets as needed.

## Run the Web App

```bash
npm run dev
```

By default, Next.js runs on:

```text
http://localhost:3000
```

## Test

```bash
npm run test
```

This runs:

- Next lint.
- TypeScript typecheck.
- CRE auth tests.

## Mock CRE Setup

For local delivery testing:

```bash
npm run cre:setup:mock
npm run dev
```

Then use the app to create a capsule with an Intent Statement and representative email.

## Useful Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Build the production app. |
| `npm run start` | Start the built app. |
| `npm run test` | Run lint, typecheck, and CRE tests. |
| `npm run test:cre` | Run CRE auth tests only. |
| `npm run cre:setup:mock` | Configure mock CRE delivery for local testing. |
| `npm run cre:setup:real` | Configure real CRE delivery. |
| `npm run worker:dashboard-index` | Run dashboard indexing worker. |

## Local Data

Local CRE store data defaults to:

```text
.data/cre-store.json
```

Do not commit local data files containing delivery metadata or test secrets.


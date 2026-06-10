---
hidden: true
---

# Environment Variables

This page documents the main environment variables used by Heres.

## Solana

| Variable                              | Required    | Purpose                                 |
| ------------------------------------- | ----------- | --------------------------------------- |
| `NEXT_PUBLIC_SOLANA_NETWORK`          | Yes         | `devnet`, `testnet`, or `mainnet-beta`. |
| `NEXT_PUBLIC_PROGRAM_ID`              | Yes         | Deployed Heres program ID.              |
| `SOLANA_RPC_URL`                      | Recommended | Server-side RPC endpoint.               |
| `SOLANA_FALLBACK_RPC_URL`             | Recommended | Fallback server RPC endpoint.           |
| `NEXT_PUBLIC_SOLANA_FALLBACK_RPC_URL` | Optional    | Client-visible fallback RPC.            |
| `NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT`  | Production  | Platform fee recipient wallet.          |
| `CRANK_WALLET_PRIVATE_KEY`            | Automation  | Wallet used by crank jobs.              |

## Helius

| Variable                     | Required    | Purpose                              |
| ---------------------------- | ----------- | ------------------------------------ |
| `NEXT_PUBLIC_HELIUS_API_KEY` | Recommended | Helius RPC and NFT/dashboard reads.  |
| `HELIUS_WEBHOOK_AUTH_TOKEN`  | Optional    | Auth token for Helius webhook route. |

## Asset Mints

| Variable                | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `NEXT_PUBLIC_BTC_MINT`  | Configured BTC-like SPL asset mint.            |
| `NEXT_PUBLIC_ETH_MINT`  | Configured ETH-like SPL asset mint.            |
| `NEXT_PUBLIC_MSOL_MINT` | mSOL mint. Devnet default is included in code. |

## MagicBlock

| Variable                             | Purpose                              |
| ------------------------------------ | ------------------------------------ |
| `NEXT_PUBLIC_ER_RPC_URL`             | Ephemeral Rollup RPC endpoint.       |
| `NEXT_PUBLIC_ER_WS_URL`              | Ephemeral Rollup websocket endpoint. |
| `NEXT_PUBLIC_TEE_RPC_URL`            | TEE RPC endpoint.                    |
| `NEXT_PUBLIC_TEE_AUTH_URL`           | TEE auth endpoint.                   |
| `NEXT_PUBLIC_ER_VALIDATOR`           | Active ER validator.                 |
| `NEXT_PUBLIC_MAGIC_PROGRAM_ID`       | Magic program ID.                    |
| `NEXT_PUBLIC_BUFFER_SEED_PROGRAM_ID` | Buffer seed program ID.              |
| `NEXT_PUBLIC_MAGIC_CONTEXT`          | Magic context account.               |
| `MAGICBLOCK_DEPLOYER_PRIVATE_KEY`    | Deployment or setup wallet.          |

## MagicBlock Private Payments

| Variable                               | Purpose                                    |
| -------------------------------------- | ------------------------------------------ |
| `USE_MAGICBLOCK_PRIVATE_PAYMENTS`      | Set to `1` to enable private payment flow. |
| `MAGICBLOCK_PRIVATE_PAYMENTS_API_KEY`  | API key.                                   |
| `MAGICBLOCK_PRIVATE_PAYMENTS_SECRET`   | Webhook signing secret.                    |
| `MAGICBLOCK_PRIVATE_PAYMENTS_BASE_URL` | Base URL for payment API.                  |

## Chainlink CRE

| Variable                                 | Purpose                                                             |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `CHAINLINK_CRE_WEBHOOK_URL`              | CRE delivery workflow endpoint.                                     |
| `CHAINLINK_CRE_API_KEY`                  | Optional CRE API key.                                               |
| `CHAINLINK_CRE_SIGNING_SECRET`           | HMAC signing secret for dispatch.                                   |
| `CHAINLINK_CRE_CALLBACK_SECRET`          | HMAC secret for callbacks.                                          |
| `CHAINLINK_CRE_REMINDER_WEBHOOK_URL`     | CRE reminder workflow endpoint.                                     |
| `CHAINLINK_CRE_REMINDER_API_KEY`         | Optional reminder API key.                                          |
| `CHAINLINK_CRE_REMINDER_SIGNING_SECRET`  | HMAC secret for reminder dispatch.                                  |
| `CHAINLINK_CRE_REMINDER_CALLBACK_SECRET` | HMAC secret for reminder callbacks.                                 |
| `CRE_DISPATCH_SECRET`                    | Protects dispatch route. Falls back to `CRON_SECRET` in some flows. |
| `CRE_STORE_PATH`                         | Optional local CRE store path.                                      |

## Local Mock CRE

| Variable                     | Purpose                                     |
| ---------------------------- | ------------------------------------------- |
| `MOCK_CRE_AUTO_CALLBACK`     | Automatically callback after mock dispatch. |
| `MOCK_CRE_FORCE_FAIL`        | Force mock CRE failure.                     |
| `MOCK_CRE_CALLBACK_BASE_URL` | Base URL for mock callbacks.                |

## Cron and Dashboard

| Variable                    | Purpose                                     |
| --------------------------- | ------------------------------------------- |
| `CRON_SECRET`               | Shared secret for protected cron endpoints. |
| `DASHBOARD_PREWARM_ENABLED` | Enables dashboard prewarm behavior.         |
| `DASHBOARD_PREWARM_PAGES`   | Pages to prewarm.                           |
| `DASHBOARD_PREWARM_TOKEN`   | Optional dashboard prewarm token.           |
| `INDEXER_BASE_URL`          | Base URL for indexer calls.                 |
| `DATABASE_URL`              | PostgreSQL connection string.               |
| `UPSTASH_REDIS_REST_URL`    | Upstash Redis URL.                          |
| `UPSTASH_REDIS_REST_TOKEN`  | Upstash Redis token.                        |

## App URL

| Variable       | Purpose                                                             |
| -------------- | ------------------------------------------------------------------- |
| `APP_BASE_URL` | Public base URL used for callbacks, links, and server-side actions. |

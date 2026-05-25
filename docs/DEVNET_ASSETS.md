# Devnet Asset Support

Heres supports this product matrix:

| Asset | Solana devnet | Stellar testnet |
| --- | --- | --- |
| BTC | SPL mint required | Issued asset required |
| ETH | SPL mint required | Issued asset required |
| SOL | Native SOL | Not supported |
| AUDD | SPL mint required | Issued asset required |
| XLM | Not supported | Native XLM |

## Findings

- There is no single canonical Solana devnet mint for wrapped BTC, wrapped ETH, or AUDD that Heres should hard-code as production truth. Use project-owned devnet SPL test mints and configure them with `NEXT_PUBLIC_BTC_MINT`, `NEXT_PUBLIC_ETH_MINT`, and `NEXT_PUBLIC_AUDD_MINT`.
- Native SOL is available on Solana devnet and does not require a mint.
- Native XLM is available on Stellar testnet through funded test accounts.
- Stellar testnet BTC, ETH, and AUDD should be project-issued test assets. Configure their issuer accounts with `NEXT_PUBLIC_STELLAR_BTC_ISSUER`, `NEXT_PUBLIC_STELLAR_ETH_ISSUER`, and `NEXT_PUBLIC_STELLAR_AUDD_ISSUER`.
- Privy supports Stellar as an extended/Tier 2 wallet chain. Heres uses Privy Stellar wallets for raw-hash signing and Stellar SDK on the server for XDR construction/submission.

## Required Env

```bash
NEXT_PUBLIC_PRIVY_APP_ID=
NEXT_PUBLIC_PRIVY_CLIENT_ID=
NEXT_PUBLIC_STELLAR_CAPSULE_ORIGIN_ENABLED=true
NEXT_PUBLIC_STELLAR_CUSTODY_PUBLIC_KEY=
STELLAR_CUSTODY_PUBLIC_KEY=
STELLAR_CUSTODY_SECRET_KEY=
STELLAR_DISTRIBUTOR_PUBLIC_KEY=
STELLAR_DISTRIBUTOR_SECRET_KEY=

NEXT_PUBLIC_BTC_MINT=
NEXT_PUBLIC_ETH_MINT=
NEXT_PUBLIC_AUDD_MINT=

NEXT_PUBLIC_STELLAR_BTC_CODE=BTC
NEXT_PUBLIC_STELLAR_BTC_ISSUER=
NEXT_PUBLIC_STELLAR_ETH_CODE=ETH
NEXT_PUBLIC_STELLAR_ETH_ISSUER=
NEXT_PUBLIC_STELLAR_AUDD_CODE=AUDD
NEXT_PUBLIC_STELLAR_AUDD_ISSUER=
STELLAR_BTC_ISSUER_SECRET_KEY=
STELLAR_ETH_ISSUER_SECRET_KEY=
STELLAR_AUDD_ISSUER_SECRET_KEY=

STELLAR_SETTLEMENT_WEBHOOK_URL=http://127.0.0.1:3000/api/mock/stellar-settlement
```

## Provisioning Notes

- Run `npm run devnet:assets` to create project-owned Solana devnet SPL mints and Stellar testnet issued assets. Use `-- --mode=solana` or `-- --mode=stellar` to provision one side only. The Solana provisioning path defaults to public devnet RPC to avoid provider-specific websocket confirmation limits; override with `SOLANA_DEVNET_PROVISION_RPC_URL` and `SOLANA_DEVNET_PROVISION_WS_URL` if needed.
- Solana devnet SPL assets must be minted by a funded Solana devnet keypair. The Heres program can then custody and distribute those SPL tokens.
- Stellar issued assets require an issuer account and a distributor account. Recipients must have a trustline for issued BTC, ETH, and AUDD before receiving payments. Native XLM does not require a trustline.
- Stellar-origin capsules use Privy Stellar raw-hash signing. The app prepares a Stellar testnet XDR, asks the Privy Stellar wallet to sign the transaction hash, submits the signed XDR to Horizon, and records the custody transaction in `.data/stellar-capsules.json`.
- For Stellar issued assets (BTC, ETH, AUDD), the local test flow first creates the user's trustline, funds the user from `STELLAR_DISTRIBUTOR_SECRET_KEY`, then locks the selected amount into `NEXT_PUBLIC_STELLAR_CUSTODY_PUBLIC_KEY`.
- Stellar beneficiary routes from Solana-origin capsules are still queued through `/api/stellar/settlement` and can be dispatched to `STELLAR_SETTLEMENT_WEBHOOK_URL`. For local development, `/api/mock/stellar-settlement` records a successful mock dispatch response.

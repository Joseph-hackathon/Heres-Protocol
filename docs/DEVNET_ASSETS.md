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
- Privy supports Stellar as an extended/Tier 2 wallet chain. The app can create a Privy Stellar wallet, but Stellar payment XDR construction and submission still require Stellar SDK logic.

## Required Env

```bash
NEXT_PUBLIC_PRIVY_APP_ID=
NEXT_PUBLIC_PRIVY_CLIENT_ID=

NEXT_PUBLIC_BTC_MINT=
NEXT_PUBLIC_ETH_MINT=
NEXT_PUBLIC_AUDD_MINT=

NEXT_PUBLIC_STELLAR_BTC_CODE=BTC
NEXT_PUBLIC_STELLAR_BTC_ISSUER=
NEXT_PUBLIC_STELLAR_ETH_CODE=ETH
NEXT_PUBLIC_STELLAR_ETH_ISSUER=
NEXT_PUBLIC_STELLAR_AUDD_CODE=AUDD
NEXT_PUBLIC_STELLAR_AUDD_ISSUER=

STELLAR_SETTLEMENT_WEBHOOK_URL=
```

## Provisioning Notes

- Run `npm run devnet:assets` to create project-owned Solana devnet SPL mints and Stellar testnet issued assets. Use `-- --mode=solana` or `-- --mode=stellar` to provision one side only.
- Solana devnet SPL assets must be minted by a funded Solana devnet keypair. The Heres program can then custody and distribute those SPL tokens.
- Stellar issued assets require an issuer account and a distributor account. Recipients must have a trustline for issued BTC, ETH, and AUDD before receiving payments. Native XLM does not require a trustline.
- Until Stellar XDR signing/submission is implemented, Stellar routes are queued through `/api/stellar/settlement` and can be dispatched to `STELLAR_SETTLEMENT_WEBHOOK_URL`.

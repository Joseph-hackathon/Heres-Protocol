# FAQ

## What is Heres?

Heres is a Solana-based capsule protocol for automated digital asset instructions. A user can lock assets, define beneficiaries, set an inactivity period, and attach an encrypted Intent Statement.

## Is Heres a wallet?

No. Heres connects to existing Solana wallets. Users keep control of their wallet keys.

## Does Heres custody my private keys?

No. Heres should never ask for a seed phrase or private key. Users sign transactions with their own wallet.

## What happens if I become active again?

The owner can refresh activity before execution. This resets the inactivity timer.

## Can anyone execute my capsule?

After the inactivity period is met, execution is permissionless by design. The program still enforces the capsule rules.

## Can beneficiaries change the capsule?

No. Beneficiaries do not control the capsule unless they are also the owner wallet.

## Can I use Heres on mainnet?

This repository defaults to Devnet. Mainnet use requires a production deployment, audited program, production automation, and correct environment configuration.

## What is the Intent Statement?

It is an encrypted private message delivered to a representative after capsule execution.

## Is Heres legal estate planning?

No. Heres is software. Users should consult qualified legal and tax professionals for estate planning.

## What if delivery fails?

CRE delivery status is tracked. Reconciliation jobs can retry or operators can review failed attempts depending on deployment configuration.

## What fees apply?

The default repository configuration includes a 0.05 SOL creation fee and a 3% execution fee. Always check the live app before signing.


# FAQ

## What is Heres Protocol ?

Heres Protocol is the world’s first autonomous 'Death Insurance Protocol' built on the Solana ecosystem.

By monitoring a user’s '**Autonomous Presence Signals**' on-chain, the protocol solves the '**Digital Graveyard**' problem. It autonomously transfers assets secured within TEE (Trusted Execution Environments) to designated heirs in the event of the owner’s absence, ensuring that digital wealth is never lost.

## Is Heres Protocol a wallet?

No. Heres connects to existing Solana wallets. Users keep control of their wallet keys.

## Does Heres custody my private keys?

No. Heres should never ask for a seed phrase or private key. Users sign transactions with their own wallet.

## What happens if I become active again?

The owner can refresh activity before execution. This resets the inactivity timer.

## Can anyone execute my capsule?

After the inactivity period is met, execution is permissionless by design. The program still enforces the capsule rules.

## Can beneficiaries change the capsule?

No. Beneficiaries do not control the capsule unless they are also the owner wallet.

## What is Capsule rule?

* You can create up to 3 capsules per wallet.
* Currently, you can create a new capsule after one capsule has been executed. (Update coming soon)
* Once a capsule is created and delegated to on-chain delegation, it is currently not possible to modify or cancel it. (Update coming soon)

## Can I use Heres Protocol on mainnet?

This repository defaults to Devnet. Mainnet use requires a production deployment, audited program, production automation, and correct environment configuration.

## What is the Intent Statement?

It is an encrypted private message delivered to a representative after capsule execution.

## Is Heres legal estate planning?

No. Heres is software. Users should consult qualified legal and tax professionals for estate planning.

## What if delivery fails?

CRE delivery status is tracked. Reconciliation jobs can retry or operators can review failed attempts depending on deployment configuration.

## What fees apply?

The default repository configuration includes a $5 subscribe fee and a 1.5% execution fee. Always check the live app before signing.

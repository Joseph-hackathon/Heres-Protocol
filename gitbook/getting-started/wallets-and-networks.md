# Wallets and Networks

## Supported Wallets

Heres uses Solana wallet adapter support in the web app. The best user experience is with wallets that support standard Solana transaction signing in the browser.

Common options:

- Phantom
- Backpack
- Solflare
- Other wallet-adapter compatible Solana wallets

For Android, the native mobile MVP uses Solana Mobile Wallet Adapter through the wallet integration in `mobile-android`.

## Network

The project is configured for Solana Devnet by default.

| Environment | Purpose |
| --- | --- |
| Devnet | Testing, demos, and development. |
| Testnet | Optional staging network if configured. |
| Mainnet Beta | Production only after deployment and security review. |

## Getting Devnet SOL

For testing, use a Solana faucet to fund your wallet with Devnet SOL. You need Devnet SOL to pay transaction fees and to lock funds in the test capsule vault.

## Explorer Links

The app builds Solana Explorer links for addresses and transactions. On Devnet, links include the `cluster=devnet` query parameter.

## Important Network Warning

A capsule created on one Solana cluster is not visible on another cluster. Make sure your wallet, app configuration, program ID, RPC URL, and explorer cluster all point to the same network.


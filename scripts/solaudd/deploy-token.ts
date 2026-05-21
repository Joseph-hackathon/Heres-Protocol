# solAUDD Token Deploy

Run this script to deploy the solAUDD SPL token on Solana. It uses TypeScript only.

## Prerequisites

1. Keypair already generated (see `keys/solaudd-authority.json`)
2. Devnet SOL for fees (~0.05 SOL)

## Steps

```bash
# To fund the wallet on devnet first:
#   npx tsx scripts/solaudd/deploy-token.ts --fund

# 2 — Deploy the token
npx tsx scripts/solaudd/deploy-token.ts

# Output will be:
#   NEXT_PUBLIC_SOLAUDD_MINT=<mint_address>     ← paste into .env.local
#   MINT_AUTHORITY=<pubkey>
```

The script:
1. Reads `keys/solaudd-authority.json` (or generates new if `--regen`)
2. Optionally airdrops 2 SOL devnet (`--fund`)
3. Creates the mint account
4. Creates the associated token account (ATA)
5. Mints the supply (set `SOLAUDD_SUPPLY=1000000000000` env var to override, default = 1 billion units, 6 decimals)
6. Revokes mint and freeze authority (recommended for a fixed-supply token)
7. Verifies and prints the 2 values you need

## After deploy

```bash
# Confirm visible on devnet explorer
echo "<paste-mint-address>" | xclip -selection clipboard   # copy mint
# Open: https://explorer.solana.com/address/<mint-address>?cluster=devnet
```

# Chainlink Support Ticket — Copy & Paste

**To:** ccip@chain.link  (or create a ticket at https://chainlinkcommunity.typeform.com/ccip-listing-request)  
**Subject:** CCIP Token Listing Request — solAUDD (SPL on Solana)

---

## Token Details

| Field | Value |
|---|---|
| Token name | Solana AUD Digital Dollar |
| Symbol | SOLAUDD |
| Solana mint address | `<FILL_FROM_manifest.json>` |
| Decimals | 6 |
| Network | Solana (devnet for tests → mainnet for production) |

---

## Requested CCIP Infrastructure

We have already [pre-signed proposeAdministrator via our mint authority](register-token.ts).
Manifest and tx sig: `ccip-output/transactions.json`

### Already completed by Heres team

- [x] Solana program (Heres) deployed — `AmiL7vEZ2SpAuDXzdxC3sJMyjZqgacvwvvQdT3qosmsW`
- [x] Vendored CCIP SVM SDK (`vendor/ccip-svm/`) integrated in `lib/ccip.ts`
- [x] `proposeAdministrator` signed — tx sig on file (see manifest)
- [x] CRE delivery + reminder workflows syntactically tested locally
- [x] Local CRE mock wiring confirmed passing

---

## What Chainlink needs to do

### Step 1 — acceptAdminRole (1 tx)
```ts
// Your admin key signs this on Solana
acceptAdminRole({
  tokenMint: "<SOLAUDD_MINT>",
  routerProgramId: "Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C",
})
// Target registry PDA:
const [tar] = PublicKey.findProgramAddressSync(
  [Buffer.from("token_admin_registry"), Buffer.from("<MINT>", "hex")],
  new PublicKey("Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C")
)
```

### Step 2 — createTokenPoolLookupTable (1 tx)
```ts
// Your admin key signs this
createTokenPoolLookupTable({
  tokenMint:        "<SOLAUDD_MINT>",
  poolProgramId:    "<use your burn-mint pool program id>",
  feeQuoterProgram: "FeeQPGkKDeRV1MgoYfMH6L8o3KeuYjwUZrgn4LRKfjHi",
  // 10 base entries are pre-derived by us (see ccip-output/transactions.json)
})
```

### Step 3 — setPool (1 tx)
```ts
setPool({
  tokenMint:      "<SOLAUDD_MINT>",
  lookupTable:    "<alt-address-from-step2>",
  writableIndexes: [...],  // from our manifest
})
```

### Step 4 — initChainRemoteConfig × N chains (N txs)

| Chain | Selector | `REMOTE_POOL_<CHAIN>` | `REMOTE_TOKEN_<CHAIN>` |
|---|---|---|---|
| Ethereum mainnet | `500929755` | `<0xEVM_pool_address>` | `<0xEVM_solAUDD_address>` |
| Sepolia | `1628171783` | `<0xEVM_pool_address>` | `<0xEVM_solAUDD_address>` |
| Polygon | `<add>` | … | … |

```ts
// For each destination chain:
initChainRemoteConfig({
  mint:                 "<SOLAUDD_MINT>",
  remoteChainSelector:  <see table above>,
  cfg: {
    poolAddresses: [Buffer.from("<REMOTE_POOL_<CHAIN>>".replace("0x", ""), "hex")],
    tokenAddress:  Buffer.from("<REMOTE_TOKEN_<CHAIN>>".replace("0x", ""), "hex").padStart(32, 0),
    decimals: 6,
  },
})
```

### Step 5 — setRateLimit per chain (optional but recommended)
```ts
// e.g. unlimited:
setRateLimit({ mint, remoteChainSelector, inbound: { enabled: false }, outbound: { enabled: false } })
```

---

## What we need from you — reply to this ticket

Please attach:
1. `acceptAdminRole` tx sig (step 1)
2. ALT address from `createTokenPoolLookupTable` (step 2)
3. Per-chain `initChainRemoteConfig` tx sigs (step 4)

Then we'll:
- Push `setPool` with the ALT address you provide
- Push per-chain `initChainRemoteConfig` on your side if you prefer
- Update our vault node URLs to your Solana RPC + CCIP router
- Deploy production CRE workflows

---

## CCIP program addresses (devnet)

| Contract | Devnet Address |
|---|---|
| Router | `Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C` |
| FeeQuoter | `FeeQPGkKDeRV1MgoYfMH6L8o3KeuYjwUZrgn4LRKfjHi` |
| RMN Remote | `RmnXLft1mSEwDgMKu2okYuHkiazxntFFcZFrrcXxYg7` |
| LINK mint | `LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L` |
| Burn-mint pool | `5cSfCuzECV5BgD4z3ZzL5yHvX5pHrLqA5eZbNMnEhs9E` |

Mainnet program IDs are the same (CCIP v0.2 uses same program IDs across all networks).
Confirm which environment(s) and we'll adjust our manifest accordingly.

---

## Questions for your team

1. Do you already have a solAUDD EVM token deployed on your destination chain(s)?
   If yes — share the token address and the EVM pool contract address.
   If no — we must stage deployment before initChainRemoteConfig.

2. Are you running a shared burn-mint pool program, or do we need a pool
   program per token?  Our manifest assumes the standard CCIP burn-mint pool.

3. Do you support Token-2022 mints on Solana, or only legacy Token Program?
   (Our code auto-detects; confirm what you expect to see.)

4. Confirm FeeQuoter Tier 1 vs Tier 2 for solAUDD to set initial rate limits.

---

## Related docs

- Chainlink CCIP docs: https://docs.chain.link/ccip/
- Chain selectors reference: https://docs.chain.link/ccip/supported-networks/
- Our README: `scripts/ccip/README.md`

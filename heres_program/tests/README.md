# Heres lean program - tests

Two-tier strategy, chosen because the program mixes base-layer lifecycle logic with MagicBlock
ER/PER CPIs that no local SVM can run.

## 1. bankrun suite (`tests/heres.test.ts`) - primary, comprehensive

Runs the exact compiled `.so` inside a local SVM (`solana-bankrun`) with a controllable `Clock`.
This is the only way to test the inactivity gate in milliseconds instead of real time:

- `execute_intent` fires only after `inactivity_period` of silence.
- `distribute_assets` and `distribute_nft` can settle immediately after firing.

Run:

```
anchor build            # produces target/deploy/heres_program.so + the IDL
yarn install
yarn test               # copies the .so into tests/fixtures/ then runs ts-mocha
```

Covered (15 base-layer instructions + edge cases, 58 cases):

| Area          | Instructions                              | Notable edge cases |
|---------------|-------------------------------------------|--------------------|
| fee config    | `update_fee_config`                       | non-authority rejected; fee cap (1 SOL) |
| lifecycle     | `create_capsule`, `deposit`, `update_intent`, `update_nft_assignments`, `cancel_capsule`, `recreate_capsule` | inactivity>0; one-per-owner; fee path + recipient validation; SOL + SPL/NFT deposit; cross-owner deposit blocked; share sum != 10000; beneficiary and NFT assignment caps; duplicate NFT assignment; deposit-after-fire |
| firing        | `execute_intent`, `update_activity`       | fires before/after inactivity; double-fire; permissionless crank; owner vs heartbeat authority; post-fire activity rejected |
| distribution  | `distribute_assets`, `distribute_nft`     | active/fired gating; immediate SOL + SPL split by share_bps; explicit NFT recipient; NFT vault ATA closure; proportional bypass protection; invalid NFT fallback; idempotent re-run; no-beneficiaries |
| escape hatch  | `recover_vault`                           | SOL + SPL; pre-fire only; non-owner rejected |

## 2. devnet (`scripts/init-fee-config.ts`) - what bankrun cannot reach

bankrun loads the program **non-upgradeable** (no `ProgramData` account), so two things are covered
against the live devnet deployment instead:

- **`init_fee_config` + the C3 upgrade-authority gate.** `scripts/init-fee-config.ts` first proves a
  non-authority signer is rejected, then initializes the singleton as the real upgrade authority.
  Run with `yarn init-fee-config`.

- **The 3 ER instructions** - `delegate_capsule`, `crank_undelegate`, `schedule_execute_intent`
  (plus the macro-generated `process_undelegation`). These CPI into the MagicBlock delegation / magic
  programs, which are not present in a local SVM. They were validated on devnet against a live
  Ephemeral Rollup. `scripts/magicblock/er-roundtrip.mjs` verifies the current Switch and private
  beneficiary/NFT-assignment roundtrip. `scripts/magicblock/nft-inheritance-check.mjs` verifies the
  full NFT custody and immediate payout path against the standard devnet build.

This split is intentional: everything testable deterministically lives in bankrun; only the parts
that genuinely require an upgradeable loader or live MagicBlock infra are devnet-only.

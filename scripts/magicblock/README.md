# MagicBlock test scripts (lean program)

Live-devnet integration scripts for the MagicBlock ER / ScheduleTask path of the lean program
(`sDRdG2qt6MKDB5Byfx7oqQLnZTDa32k1qM3hDSBmQUz`). These exercise the parts the bankrun suite
(`tests/`) cannot: bankrun loads the program non-upgradeable with no MagicBlock programs present,
so delegation, the autonomous ScheduleTask crank, and undelegation are devnet-only.

## er-roundtrip.mjs (current, canonical)

Full Model-A Switch+Vault round-trip on a live ER:

```
create_capsule (base)        Switch + Vault, NO beneficiaries on base (privacy D8)
deposit SOL    (base)        fund the Vault (the Vault is NEVER delegated)
delegate_capsule (base)      delegate ONLY the Switch to the validator/ER
update_activity  (ER)        relayer heartbeat bumps last_activity on the ER copy
update_intent    (ER)        set the PRIVATE beneficiary list on the ER copy
schedule_execute_intent (ER) register the autonomous ScheduleTask crank
<wait>                       MagicBlock runs execute_intent itself (no off-chain crank)
crank_undelegate (ER)        commit + undelegate the Switch back to base
verify (base)                is_active=false, executed_at set, beneficiaries survived intact
```

Run:

```bash
node scripts/magicblock/er-roundtrip.mjs
```

Env knobs (all optional): `ER_RPC` (default `devnet-as.magicblock.app`), `VALIDATOR`
(default Asia `MAS1Dt9...`), `BASE_RPC` (defaults to the keyed Helius URL in the solana CLI
config, falling back to public devnet), `INACTIVITY`, `SCHEDULE_INTERVAL_MS`, `SCHEDULE_ITERS`,
`FUND_SOL`, `DEPOSIT_SOL`, `FIRE_WATCH_S`.

Notes:

- Uses a throwaway generated owner funded from `~/.config/solana/id.json`. Each run strands
  ~`FUND_SOL` devnet SOL in that owner/vault (the capsule fires, so it can't be cancelled, and
  `distribute_assets` is grace-gated). Harmless on devnet.
- `heartbeat_authority` = `heres-relayer`; `crank_undelegate` payer = `heres-crank`.
- `distribute_assets` is gated by a 48h `GRACE_PERIOD`, so it is NOT run here - it stays covered
  by the clock-warped bankrun suite. This script validates the ER mechanics + the Tier-1 privacy
  property (beneficiaries set on the ER are invisible on base while delegated, then revealed on
  undelegate).
- Last green run: 10/10 checks, autonomous fire ~3s after scheduling. The Asia ER is a regular
  (non-TEE) ER; a PER/TEE pass (which would also test the permission-ACL read/write model,
  redesign Open Q7) is a separate follow-on.

## measure-scheduletask-cost.mjs (historical)

The cost probe that resolved redesign Open Q3 (ScheduleTask = FREE: no schedule fee, no escrow,
0 per-tick charge, fires autonomously) on 2026-06-11. Targets the OLD program `2fLojZ` and the old
account model, so it is kept only as the evidence trail - not a current test. See the file header.

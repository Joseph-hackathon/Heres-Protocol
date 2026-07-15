# MagicBlock test scripts (lean program)

Live-devnet integration scripts for the MagicBlock ER / ScheduleTask path of the lean program
(`sDRdG2qt6MKDB5Byfx7oqQLnZTDa32k1qM3hDSBmQUz`). These exercise the parts the bankrun suite
(`tests/`) cannot: bankrun loads the program non-upgradeable with no MagicBlock programs present,
so delegation, the autonomous ScheduleTask crank, and undelegation are devnet-only.

## er-roundtrip.mjs (current, canonical)

Full two-ER lifecycle across Solana devnet, a regular ER, and the authenticated TEE:

```
create_capsule (base)                  Switch + BeneficiarySet + Vault
deposit SOL (base)                     fund the Vault, which is never delegated
delegate_capsule (base)                delegate the Switch to a regular ER
delegate_beneficiaries (base)          delegate the private set to the TEE
update_intent + seal (TEE)             write and seal private settlement state
update_activity + schedule (regular ER) prove token-free heartbeat and autonomous fire
crank_undelegate (regular ER)          commit the fired Switch back to base
crank_undelegate_beneficiaries (TEE)   reveal only after the TEE reads the fired base Switch
distribute_assets (base)               pay the live SOL leg at the committed 60/40 split
finalize_capsule (base)                close all three core PDAs to the fee recipient
verify                                  prove privacy, payout, rent recovery, and account deletion
```

Run:

```bash
node scripts/magicblock/er-roundtrip.mjs
```

Env knobs (all optional): `SWITCH_ER_RPC` (default `devnet-as.magicblock.app`), `TEE_RPC`
(default `devnet-tee.magicblock.app`), `SWITCH_VALIDATOR`, `TEE_VALIDATOR`, `BASE_RPC`
(defaults to the keyed devnet URL in the Solana CLI config), `INACTIVITY`,
`SCHEDULE_INTERVAL_MS`, `SCHEDULE_ITERS`, `FUND_SOL`, `DEPOSIT_SOL`, and `FIRE_WATCH_S`.

Notes:

- Uses a throwaway generated owner funded from `~/.config/solana/id.json`. The live SOL deposit is
  paid to generated beneficiaries and the capsule accounts are finalized before the run exits.
- `heartbeat_authority` = `heres-relayer`; `crank_undelegate` payer = `heres-crank`.
- The generated NFT assignment proves private TEE storage and round-trip integrity; live NFT token
  transfer remains covered by `nft-inheritance-check.mjs`.
- Last green run: 25/25 checks on 2026-07-15, including TDX attestation, TEE ACL filtering,
  autonomous fire, cross-ER reveal, exact SOL payout, finalization, and account deletion.

## measure-scheduletask-cost.mjs (historical)

The cost probe that resolved redesign Open Q3 (ScheduleTask = FREE: no schedule fee, no escrow,
0 per-tick charge, fires autonomously) on 2026-06-11. Targets the OLD program `2fLojZ` and the old
account model, so it is kept only as the evidence trail - not a current test. See the file header.

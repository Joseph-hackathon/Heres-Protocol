# Verification Runbook

This runbook consolidates the existing verification paths for the requested runtime integrations.

## Baseline

- Static validation:
  - `npm test`
- CRE auth-only validation:
  - `npm run verify:cre:mock`

## MagicBlock

- Delegation and crank scheduling:
  - `npm run verify:magicblock`
- Full capsule end-to-end:
  - `npm run verify:capsule:e2e`

### Required environment

- `NEXT_PUBLIC_PROGRAM_ID`
- `NEXT_PUBLIC_ER_RPC_URL` if not using default MagicBlock devnet
- funded Solana test wallets / keypairs expected by the scripts
- any RPC overrides used by your current deployment

### What these scripts cover

- capsule creation
- MagicBlock delegation
- crank scheduling on ER
- undelegation/execution flow where supported by the script path

## Chainlink CRE

- Mock setup plus auth validation:
  - `npm run verify:cre:mock`

### For real CRE workflow validation

- configure:
  - `CHAINLINK_CRE_WEBHOOK_URL`
  - `CHAINLINK_CRE_API_KEY`
  - `CHAINLINK_CRE_SIGNING_SECRET`
  - `CHAINLINK_CRE_CALLBACK_SECRET`
  - reminder equivalents where used
- then run:
  - `npm run cre:setup:real`
  - `npm run verify:capsule:e2e`

### What to inspect after execution

- `/api/intent-delivery/status`
- `/api/intent-reminder/status`
- callback routes under `app/api/cre/`
- any Redis or durable store entries created by CRE dispatch and reconciliation

## Notes

- The repository already contains more than one script path for similar flows. Use this document as the canonical entrypoint list.
- Live devnet verification still depends on funded keys and external service secrets. Without those, only static and mock verification can be completed locally.

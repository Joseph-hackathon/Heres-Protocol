# Privacy and Security

Heres is designed to reduce unnecessary exposure of sensitive intent data while keeping settlement verifiable on Solana.

## Privacy Model

Heres separates three kinds of information:

| Data | Where It Lives | Notes |
| --- | --- | --- |
| Liveness Switch | Solana or regular MagicBlock ER | Holds activity, trigger, execution, and public commitment state, but no beneficiary list or funds. |
| Beneficiary and NFT rules | Permissioned MagicBlock TEE while active | Stored in a separate `BeneficiarySet` and revealed to Solana only for post-fire settlement. |
| Vault assets | Solana | The vault and canonical token accounts remain on the base layer and are independently verifiable. |
| Settlement commitment | Switch plus private BeneficiarySet | The public Switch stores a SHA-256 commitment; the matching private salt stays in the TEE until reveal. |
| Private statement | Encrypted payload store and CRE delivery flow | Intended to remain encrypted outside confidential delivery. |

## Private Execution

MagicBlock uses two execution locations. The liveness Switch runs on a regular ER for token-free heartbeat and scheduled execution, while the `BeneficiarySet` runs in the authenticated TEE. New capsules write and seal their settlement rules in the TEE before the regular-ER Switch is armed.

After sealing, the program rejects beneficiary and NFT-assignment edits. Distribution also recomputes the revealed configuration commitment and rejects settlement if it differs from the commitment used to arm the Switch.

## Client-Side Encryption

The private Intent Statement is encrypted before delivery registration. The flow uses browser crypto primitives and stores encrypted payload metadata rather than plaintext in normal app storage.

This encryption applies to the off-chain Intent Statement. On-chain beneficiary privacy uses the separate TEE-resident account and commitment flow described above.

## Settlement and Finalization Safety

- New vaults track native SOL and registered classic SPL or Token-2022 account legs.
- Token deposits reject Token-2022 extensions that can change transfer authorization, fees, balances, or required accounts.
- Distribution validates each tracked token account and decrements the manifest only when that asset leg closes.
- Finalization requires an executed capsule and an empty tracked vault.
- The caller cannot redirect reclaimed rent because the on-chain fee configuration pins the recipient.

## Signed Requests

Heres uses signatures to protect sensitive API actions:

- Wallet-signed registration and status messages.
- HMAC signed CRE dispatch calls.
- HMAC verified callbacks from CRE.
- Cron secrets for protected automation endpoints.

## Smart Contract Risks

Users should understand that smart contracts can contain bugs and that transaction signing is final on-chain. Before production use:

- Audit the Anchor program.
- Review upgrade authority and deployment controls.
- Test fee configuration.
- Test all execution and distribution paths.
- Verify private execution and callback security.
- Monitor failures and retry queues.

## User Safety Guidelines

- Never share wallet seed phrases.
- Verify addresses before creating a capsule.
- Use a representative email that will remain accessible.
- Test with small amounts first.
- Keep backup legal and operational plans outside the protocol.
- Review local laws before using Heres for inheritance or estate planning.

# Privacy and Security

Heres is designed to reduce unnecessary exposure of sensitive intent data while keeping settlement verifiable on Solana.

## Privacy Model

Heres separates three kinds of information:

| Data | Where It Lives | Notes |
| --- | --- | --- |
| Capsule state | Solana | Public and verifiable. |
| Intent metadata | Capsule intent data | Serialized data needed for execution and display. |
| Private statement | Encrypted payload store and CRE delivery flow | Intended to remain encrypted outside confidential delivery. |

## Private Execution

MagicBlock ER/PER is used for private monitoring and automated execution paths. The app can delegate capsule accounts for private condition monitoring and scheduled execution.

## Client-Side Encryption

The private Intent Statement is encrypted before delivery registration. The flow uses browser crypto primitives and stores encrypted payload metadata rather than plaintext in normal app storage.

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


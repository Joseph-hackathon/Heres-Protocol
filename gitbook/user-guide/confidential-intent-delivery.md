# Confidential Intent Delivery

Heres uses Chainlink CRE to deliver encrypted off-chain Intent Statements after capsule execution.

## What Is an Intent Statement?

An Intent Statement is a private message attached to a capsule. It can explain what the capsule means, why the beneficiaries were chosen, or what the representative should do after execution.

Examples:

- Recovery instructions.
- A final note.
- Location of important documents.
- Context for the beneficiary transfer.

## How Delivery Works

1. The owner writes an Intent Statement during capsule creation.
2. The browser encrypts the statement before registration.
3. The app stores an encrypted payload and delivery metadata.
4. The capsule stores a reference and integrity hash on-chain.
5. After capsule execution, the reconciliation job dispatches delivery.
6. Chainlink CRE receives a signed webhook.
7. CRE decrypts and delivers the statement to the representative.
8. CRE calls back to Heres with delivery status.

## Why CRE Is Used

CRE gives Heres an isolated runtime for sensitive delivery actions. The application backend should not need to handle plaintext statements during normal operation.

## Representative Email

The representative email is required in the current flow. It identifies where the decrypted Intent Statement should be delivered after execution.

Use an email address that will still be reachable when the capsule may execute.

## Unlock Code

The unlock code helps derive the encryption key for the private message. Choose a code that is not easy to guess. Do not reuse wallet seed phrases or account passwords.

## Delivery Safety

Heres includes several delivery protections:

- Wallet signature verification for registration and status checks.
- HMAC signed CRE dispatch calls.
- HMAC verified CRE callbacks.
- Secret references and hashes for integrity checks.
- Idempotency keys to prevent duplicate delivery for the same execution.
- Retry support through reconciliation jobs.


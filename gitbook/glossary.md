# Glossary

## Beneficiary

The wallet address or recipient configured to receive assets after a capsule executes.

## Capsule

An on-chain Heres account that stores owner, activity, intent, vault, and execution state.

## CRE

Chainlink Runtime Environment. Heres uses CRE for confidential delivery of encrypted Intent Statements.

## Delegation

The process of delegating capsule execution or monitoring to MagicBlock ER/PER infrastructure.

## Draft

A capsule whose accounts were created but whose liveness Switch has not yet been armed with a sealed inheritance commitment. A draft cannot execute.

## Devnet

Solana's development network. Tokens have no real-world value and are used for testing.

## Execution

The protocol action that marks a capsule as no longer active and records an execution timestamp after inactivity conditions are met.

## Finalization

The terminal action that closes an executed and fully settled capsule's Switch, BeneficiarySet, and Vault accounts. Reclaimed rent goes to the recipient fixed in the on-chain fee configuration.

## Alchemy

Infrastructure provider used for RPC, NFT reads, enhanced transactions, and dashboard support.

## Inactivity Period

The configured time window after the owner's last activity before the capsule becomes eligible for execution.

## Intent Statement

A private encrypted message attached to a capsule and delivered after execution.

## Inheritance Commitment

A SHA-256 digest of the ordered beneficiary shares, NFT assignments, owner, and private salt. The public Switch stores this value so settlement can prove that the revealed configuration matches the rules sealed before activation.

## Seal

The one-way boundary that freezes a new capsule's private beneficiary and NFT configuration inside the TEE before the liveness Switch is armed.

## MagicBlock ER/PER

MagicBlock Ephemeral Rollup and Private Ephemeral Rollup infrastructure used for private monitoring and automated execution.

## PDA

Program Derived Address. A deterministic Solana address controlled by a program rather than a private key.

## Representative

The email recipient for the encrypted Intent Statement.

## Vault

The program-controlled address or token account that holds capsule assets until distribution.

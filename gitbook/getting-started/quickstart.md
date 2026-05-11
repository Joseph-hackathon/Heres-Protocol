# Quickstart

This guide helps a user create and monitor a Heres capsule from the web app.

## Before You Begin

You need:

- A Solana wallet such as Phantom or Backpack.
- Devnet SOL for testing.
- A stable internet connection.
- A beneficiary wallet address.
- A representative email address for Intent Statement delivery.
- An unlock code for encrypting the private statement.

Heres currently defaults to Solana Devnet in this repository. Mainnet deployment requires production configuration, deployed contracts, production automation, and operational review.

## Create Your First Capsule

1. Open the Heres web app.
2. Select **Create Capsule**.
3. Connect your Solana wallet.
4. Choose the asset type:
   - Token assets such as SOL or configured SPL assets.
   - NFT assets when NFT support is enabled and available through your wallet.
5. Enter beneficiaries.
6. Set the amount each beneficiary should receive.
7. Set the inactivity period.
8. Write your Intent Statement.
9. Enter the representative email address.
10. Create an unlock code for the encrypted statement.
11. Review the capsule details.
12. Confirm the transaction in your wallet.

After confirmation, Heres creates a capsule account and vault on Solana. The capsule detail page shows the capsule address, owner, status, vault, activity deadline, and available actions.

## Monitor a Capsule

Open **My Capsule** or visit the capsule detail page. From there, you can:

- Check whether the capsule is active, expired, inactive, or executed.
- Copy the capsule address.
- Open transactions in Solana Explorer.
- Refresh automation registration.
- Execute the capsule after the inactivity window has passed.
- Distribute assets after execution.
- Check CRE delivery status for the Intent Statement.

## Keep a Capsule Active

If you are still active and do not want the capsule to execute, refresh activity before the inactivity deadline. The owner can update activity from the app or mobile flow when the feature is exposed in the current deployment.

## What Happens After Inactivity

When the inactivity period has passed:

1. The capsule becomes eligible for execution.
2. A permitted automation process or user can call execution.
3. The capsule is marked as executed.
4. Distribution sends assets to beneficiaries.
5. Chainlink CRE delivery sends the encrypted Intent Statement to the representative.

Execution and distribution are separate steps in the protocol. This separation keeps the state transition clear and supports the MagicBlock execution flow.


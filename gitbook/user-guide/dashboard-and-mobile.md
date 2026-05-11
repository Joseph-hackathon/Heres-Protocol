# Dashboard and Mobile

## Dashboard

The dashboard provides a broad view of protocol activity. It is designed for operators, demo users, and teams reviewing capsule state.

Dashboard views may include:

- Total capsules.
- Active capsules.
- Executed capsules.
- Total value secured.
- Asset mix.
- Recent events.
- Transaction status.
- Capsule owner and address references.

The dashboard reads data from Solana RPC, Helius APIs, and optional local or database indexes depending on deployment configuration.

## My Capsule

The **My Capsule** page checks the connected wallet and redirects to the wallet owner's capsule when one exists. If no capsule exists, it guides the user to create one.

## Mobile App

The Android module is a native MVP for monitoring and mobile-first capsule actions.

Current scope:

- Activity measurement from on-chain signals.
- Create capsule API wiring.
- My Capsule and detail views.
- One-tap extension flow scaffold.
- Unsigned transaction creation for mobile signing.
- Solana Mobile Wallet Adapter integration.

## Mobile Setup

1. Open `mobile-android` in Android Studio.
2. Configure `API_BASE_URL` in the Android build settings.
3. Build and run on Android 8.0 or newer.
4. Test signing with a wallet that supports Solana Mobile Wallet Adapter.

## Activity Score

The mobile API includes an activity score based on recent wallet activity. The score can recommend whether a user should extend or continue monitoring.

This score is an application-level helper. The on-chain capsule state remains the source of truth for execution eligibility.


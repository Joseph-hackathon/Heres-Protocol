# PR Breakdown

This document breaks the requested scope into independent PRs with the current codebase state, dependency notes, and validation paths.

## Baseline

- Branch point: `main`
- Baseline verification on 2026-05-18:
  - `npm test` ✅
  - Includes `next lint`, `tsc --noEmit`, and `tests/cre-auth.test.mts`

## Proposed PR Order

### PR 1. Task analysis and workstream map

- Goal: freeze scope, dependencies, and verification strategy before feature work.
- Current state:
  - BTC and ETH already exist in [lib/assets.ts](/Users/yong/snorlax/Heres-Protocol/lib/assets.ts) and [constants/index.ts](/Users/yong/snorlax/Heres-Protocol/constants/index.ts)
  - Helius is still wired into dashboard, NFT fetch, and webhook paths
  - Alchemy exists only as branding in the current UI
- Validation:
  - `npm test`

### PR 2. Remove logo-based external redirects

- Goal: prevent logo images from navigating users to third-party websites.
- Current state:
  - Partner logo badges on [app/page.tsx](/Users/yong/snorlax/Heres-Protocol/app/page.tsx) are external anchors
  - Main site logo in [components/Navbar.tsx](/Users/yong/snorlax/Heres-Protocol/components/Navbar.tsx) routes internally to `/`
  - Footer logo is static in [components/Footer.tsx](/Users/yong/snorlax/Heres-Protocol/components/Footer.tsx)
- Scope decision:
  - Remove third-party redirects from clickable logo images first
  - Keep plain text or non-logo CTAs navigable if they are still product-relevant
- Validation:
  - `npm test`
  - manual homepage interaction check

### PR 3. Navy color token and UI theme pass

- Goal: add navy to the system palette and apply it intentionally across the main UI.
- Current state:
  - Theme tokens live in [app/globals.css](/Users/yong/snorlax/Heres-Protocol/app/globals.css)
  - Many surfaces already use deep blue hex values directly instead of semantic navy tokens
- Validation:
  - `npm test`
  - visual review on landing, dashboard, create, capsule detail

### PR 4. BTC and ETH support verification hardening

- Goal: verify BTC and ETH support paths and close gaps with tests or guardrails.
- Current state:
  - Assets are configured in [lib/assets.ts](/Users/yong/snorlax/Heres-Protocol/lib/assets.ts)
  - Env lookup tests already exist in [tests/network-config.test.mts](/Users/yong/snorlax/Heres-Protocol/tests/network-config.test.mts)
  - Create flow uses `SUPPORTED_TOKEN_ASSETS` in [app/create/page.tsx](/Users/yong/snorlax/Heres-Protocol/app/create/page.tsx)
- Expected work:
  - verify mint handling, decimals, create flow selection, detail page rendering
  - add missing tests around asset registry behavior
- Validation:
  - `npm test`
  - targeted asset tests

### PR 5. `solAUDD` asset addition on Solana

- Goal: add Solana-side `solAUDD` asset support.
- Dependencies:
  - should land after PR 4 so asset-path guardrails already exist
- Expected work:
  - extend asset registry and env handling
  - update create/detail/dashboard rendering
  - add tests for mint lookup and decimals
- Open dependency:
  - actual mint address and decimals must be confirmed from deployment/env
- Validation:
  - `npm test`
  - asset-specific tests

### PR 6. Stellar Lumen network integration and Stellar AUDD path

- Goal: support Stellar/XLM network integration and expose AUDD on Stellar as well.
- Current state:
  - no Stellar integration code is present in app/lib/scripts search results
  - beneficiary model currently assumes `solana` or `evm` style paths in multiple places
- Expected work:
  - add Stellar network/domain model
  - extend beneficiary validation and serialization
  - define how execution/distribution interacts with Stellar
- Risk:
  - this is not a UI-only task; it likely requires new service integration and protocol decisions
- Validation:
  - new Stellar tests
  - flow simulation or integration harness

### PR 7. Explorer privacy mode

- Goal: apply private explorer behavior such as lock iconography and detail suppression.
- Current state:
  - public detail endpoints exist in [app/api/capsules/[id]/route.ts](/Users/yong/snorlax/Heres-Protocol/app/api/capsules/%5Bid%5D/route.ts)
  - dashboard and detail pages expose owner and transaction information broadly
- Expected work:
  - add privacy mode to dashboard/detail data shaping
  - suppress sensitive transaction detail views
  - add lock indicators in UI
- Validation:
  - `npm test`
  - manual regression on dashboard and capsule detail

### PR 8. My Capsule authorization and PDF export

- Goal:
  - only creator can view capsule details initially
  - after successful long-running operation, only beneficiary can view specific details
  - export executed capsule flow as PDF report
- Current state:
  - [app/capsules/page.tsx](/Users/yong/snorlax/Heres-Protocol/app/capsules/page.tsx) is wallet-gated but [app/capsules/[address]/page.tsx](/Users/yong/snorlax/Heres-Protocol/app/capsules/%5Baddress%5D/page.tsx) and its API backing are not enforcing equivalent privacy semantics
  - no PDF generation library is currently wired
- Risk:
  - requires a durable authorization model, beneficiary eligibility rules, and a reporting format
- Validation:
  - auth-focused tests
  - PDF generation smoke test

### PR 9. MagicBlock verification suite

- Goal: verify personal payment flow, Crank scheduling, and PER behavior.
- Current state:
  - existing scripts: [scripts/test-er-delegation.mjs](/Users/yong/snorlax/Heres-Protocol/scripts/test-er-delegation.mjs), [scripts/test-capsule-e2e.ts](/Users/yong/snorlax/Heres-Protocol/scripts/test-capsule-e2e.ts), [scripts/e2e-full-flow.mjs](/Users/yong/snorlax/Heres-Protocol/scripts/e2e-full-flow.mjs)
- Expected work:
  - normalize scripts into a clear verification path
  - document required env and expected outputs
  - close identified failures if verification exposes regressions
- Validation:
  - script-level execution with documented env

### PR 10. Chainlink CRE verification suite

- Goal: verify email delivery path and callback loop.
- Current state:
  - runtime logic exists in [lib/cre/service.ts](/Users/yong/snorlax/Heres-Protocol/lib/cre/service.ts)
  - reminder flow exists in [lib/cre/reminder-service.ts](/Users/yong/snorlax/Heres-Protocol/lib/cre/reminder-service.ts)
  - test coverage is currently auth-centric, not full workflow-centric
- Expected work:
  - add executable verification path for dispatch, callback, reminder, and reconciliation
- Validation:
  - existing auth tests
  - workflow smoke tests with mock CRE endpoints

### PR 11. Alchemy integration and Helius removal

- Goal: fully replace Helius dependencies with Alchemy.
- Current state:
  - Helius is used in:
    - [lib/helius.ts](/Users/yong/snorlax/Heres-Protocol/lib/helius.ts)
    - [app/api/helius/nfts/route.ts](/Users/yong/snorlax/Heres-Protocol/app/api/helius/nfts/route.ts)
    - [app/api/helius/webhook/route.ts](/Users/yong/snorlax/Heres-Protocol/app/api/helius/webhook/route.ts)
    - [app/dashboard/page.tsx](/Users/yong/snorlax/Heres-Protocol/app/dashboard/page.tsx)
    - [app/create/page.tsx](/Users/yong/snorlax/Heres-Protocol/app/create/page.tsx)
    - multiple scripts and docs
  - Alchemy branding exists, but runtime integration does not
- Risk:
  - this is a large refactor touching RPC, NFTs, transaction indexing, and webhook architecture
- Validation:
  - `npm test`
  - dashboard and NFT flow smoke checks
  - webhook replacement verification

### PR 12. UX/UI update pass

- Goal: apply the broader UX/UI updates after structural work settles.
- Scope note:
  - this should absorb only cross-screen polish not already captured by PR 2, 3, 7, or 8
- Validation:
  - `npm test`
  - manual responsive review

### PR 13. Codebase cleanup and version hygiene

- Goal: directory cleanup, version consistency, and dead-path removal.
- Current state:
  - repo contains both `package-lock.json` and `pnpm-lock.yaml`
  - multiple temporary JSON artifacts exist at repo root
- Scope:
  - clean only after the feature branches land, otherwise cleanup churn will conflict with all active PRs
- Validation:
  - `npm test`
  - ensure build artifacts or required fixtures are not removed accidentally

## Notes

- PR 5, PR 6, PR 8, and PR 11 have external dependency or product-rule ambiguity and should be handled after the smaller hardening PRs.
- The most dangerous item is Helius removal because it touches live data sourcing, webhook ingestion, and dashboard behavior simultaneously.
- The most likely hidden backend work is the Stellar integration and beneficiary-visibility rules.

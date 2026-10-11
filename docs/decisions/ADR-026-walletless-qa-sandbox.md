# ADR-026: Walletless UI QA with page-local synthetic state

Status: Accepted for UI QA; implementation acceptance recorded separately
Date: 2026-10-11

## Context

A QA developer needs to inspect every operator section, create and modify test records, and walk through all three corporate-action types without installing a wallet. The public staging dashboard retains wallet authentication, and its cloud API cannot reach the owner's loopback validator. Removing authentication or treating synthetic signatures as real wallet proof would weaken the existing boundary.

## Options considered

1. Disable backend authentication for staging. This exposes shared records and does not provide a functional cloud chain flow.
2. Provision a QA wallet and a separate API/database/validator environment. This is suitable for integration testing but retains the wallet prerequisite and adds hosted infrastructure.
3. Reuse the operator workspace with a page-local synthetic request adapter and explicit QA stage controls. This provides independent UI testing without changing server security or financial validators.

## Decision

Use a public `/qa` route that mounts the existing `OperatorWorkspace` directly. It does not mount wallet login, register a Wallet Standard provider or establish session cookies. An in-memory adapter supplies synthetic records to existing forms; unsupported routes fail without a network fallback.

Expose issuer administrator, separate approver administrator and Auditor identities. Explicit QA controls simulate the stages that normally require a wallet: activation, scheduling, snapshot, calculation registration, funding/reserve, separate approval, per-investor payment/burn and finalization. Synthetic transactions/receipts are marked as simulation and contain no valid signed Solana wire.

Keep state within the current page instance. Reload/reset starts fresh fixtures, and reset affects only sandbox memory. Export marked QA state JSON for reproducible UI reports. The protected dashboard, API authentication, chain flags and exact-wire signing validators remain unchanged.

## Reasoning

Existing screens and forms make QA findings relevant to the operator product. A separate public route provides access without creating an alternative backend login. In-memory state prevents one tester from altering another tester's data or the owner's state and requires no paid infrastructure or new secrets.

## Consequences and risks

The QA link supports navigation, forms, visible permissions, simulated workflows and responsive review. Fixtures reset on reload and are not shared across tabs/devices. Testers must export before reset if a finding depends on mutated state.

The adapter must fail closed on unsupported paths and must never forward a request to the real API/RPC. Clear labels are necessary because synthetic finalized statuses do not prove settlement, wallet ownership or server security. Role switching checks UI visibility only.

## Future work

Verify the three simulated flows, role restrictions, page reset/export and absence of application API/RPC calls in automated and browser checks. Use a separate authenticated integration environment for persistence, concurrency, sessions, Phantom, signed transactions and real Solana acceptance. Add hosted integration QA only when that separate requirement is authorized.

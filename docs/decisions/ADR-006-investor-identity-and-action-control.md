# ADR-006: Investor identity and controlled corporate action completion

Status: Accepted
Date: 2026-09-28
Amended: 2026-09-30

## Context

The additional MVP requirements distinguish investors from wallets, require approval before execution, and require explicit settlement and final action evidence. The earlier wallet-level snapshot and entitlement identity cannot represent one investor owning several wallets without duplicate payouts.

## Options considered

1. Keep wallet-level entitlements and merge their results only in the UI.
2. Use Investor ID as the entitlement identity and preserve wallet/token-account provenance in a new snapshot version.
3. Move all investor identity and approvals on-chain in the MVP.

## Decision

Use stable Investor UUID as the entitlement identity and PDA seed. Snapshot-v2 records investor → wallet → token account, eligibility at the effective finalized capture slot, balances, slot, and supply. The planned `record_at` only opens the demo capture window, as clarified in ADR-002. Wallet proof must predate the effective slot; a finalized slot before `record_at` is rejected. Payout still targets a separately verified active wallet, checked again at execution. The immutable finalized snapshot never changes during review; return for revision recalculates against the same snapshot.

Execution requires an approved action. Each entitlement has Cash and Asset Legs; coupon Asset Leg is not applicable. The existing atomic per-entitlement transaction remains the settlement boundary. Action finalization requires confirmed required legs, matched reconciliation, and a final JSON Action Receipt with on-chain commitment.

## Reasoning

One entitlement per investor avoids double payment across wallets and keeps ownership evidence inspectable. Approval is a separate decision from calculation. Explicit legs and a final receipt make partial settlement and audit status understandable.

## Consequences

- The pre-MVP database migration stops if domain records exist; live-data conversion needs a separate migration plan.
- Snapshot-v1 hash vectors remain readable, while new snapshots use snapshot-v2.
- The on-chain program must adopt investor UUID seeds and a final Action Receipt PDA before end-to-end acceptance.
- One administrator may create and approve in the demo, but both actor IDs and events are retained for later role separation.

## Risks

- Investor-to-wallet mapping can be wrong or stale. Wallet verification and snapshot reconciliation are required.
- Current registry rows have no effective-time history. Until mutations are frozen or versioned around capture, their status at the historical finalized slot cannot be independently reconstructed; the demo must not claim otherwise.
- An eligibility change after record date does not rewrite history; it may block payout and require an explicit operational decision.
- Database transfer flags do not enforce direct Token-2022 transfers. Transfer Hook and freeze authority need a separate security design.

## Future work

Add distinct maker/checker authorization, transfer controls, recovery governance, and a live-data migration strategy before a production pilot.

# ADR-002: Finalized current-slot record-date snapshots

Status: Accepted
Date: 2026-09-28
Amended: 2026-09-30

## Context

Corporate-action entitlements must be derived from a reproducible ownership snapshot. Standard RPC nodes do not guarantee arbitrary historical Token-2022 account reconstruction, and silently using current balances for a past record date would produce unverifiable entitlements.

## Options considered

1. Reconstruct any historical record date from ordinary RPC calls.
2. Depend on a third-party archival indexer in the MVP.
3. Capture the current finalized slot during the configured snapshot window and reject missed windows.
4. Store only calculated entitlements without retaining the source snapshot.

## Decision

The Devnet MVP captures balances only at a current `finalized` slot during the window that begins at `record_at`. `record_at` is the planned opening of capture, not a proven legal ownership cut-off. The effective demo entitlement point is the captured `snapshot-v2` `solana_slot` and `block_time`; both planned and effective points must be shown separately. The MVP does not backdate or approximate ownership at the planned timestamp.

The API serializes balances using the versioned `snapshot-v2` canonical JSON contract (investor → wallet → token account), computes SHA-256 over the exact UTF-8 bytes, and stores the immutable payload in PostgreSQL. The program stores the snapshot slot, hash, investor count, wallet count, and aggregate token amount. `snapshot-v1` remains a historical test vector only.

If the snapshot window is missed, the action is blocked as `SNAPSHOT_MISSED` in orchestration and requires an explicit administrator decision; it must not continue using a later balance set under the original record date. The on-chain missed-state transition is not yet implemented and must not be presented as confirmed chain state.

## Reasoning

This design makes the MVP reproducible without claiming historical capabilities the chosen infrastructure does not provide. A transfer between `record_at` and the captured slot can change the holder entitled in the demo; presenting the latter as ownership at the planned timestamp would be false. The on-chain hash detects alteration of a retained canonical payload but does not prove the payload, identity mapping, RPC finality, or holder enumeration was correct.

## Consequences

- Operational scheduling around record dates is mandatory.
- Snapshot jobs must be observable and retryable within the allowed window.
- Historical snapshot support is excluded from MVP scope.
- A strict contractual record-date cut-off cannot be served by this mode; it needs an enforceable checkpoint/transfer-control or independently verified historical source plus legal and operator approval.
- Investor-level canonical payload access is restricted; public evidence is limited to non-identifying commitment metadata.
- A hash match proves payload integrity, not that the RPC provider returned a complete universe; reconciliation and provider controls remain necessary.

## Risks

- RPC degradation near the record date can cause a missed snapshot.
- Incomplete token-account enumeration could produce a self-consistent but incomplete snapshot.
- Canonicalization differences across implementations could change the hash.
- Transfer between the planned timestamp and effective capture can change demo entitlements; redemption additionally fails closed if current burn-source balances no longer match the frozen entitlement.

## Future work

- Evaluate archival RPC or indexer support with explicit completeness guarantees.
- Add multi-provider comparison for high-value actions.
- Formalize the snapshot schema and publish cross-language test vectors.
- Decide the legal register and implement an auditable checkpoint before any regulated pilot.

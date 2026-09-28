# ADR-002: Finalized current-slot record-date snapshots

Status: Accepted
Date: 2026-09-28

## Context

Corporate-action entitlements must be derived from a reproducible ownership snapshot. Standard RPC nodes do not guarantee arbitrary historical Token-2022 account reconstruction, and silently using current balances for a past record date would produce unverifiable entitlements.

## Options considered

1. Reconstruct any historical record date from ordinary RPC calls.
2. Depend on a third-party archival indexer in the MVP.
3. Capture the current finalized slot during the configured snapshot window and reject missed windows.
4. Store only calculated entitlements without retaining the source snapshot.

## Decision

The MVP captures balances only at the current `finalized` slot during the record-date snapshot window. It does not backdate or approximate ownership.

The API serializes balances using the versioned `snapshot-v2` canonical JSON contract (investor → wallet → token account), computes SHA-256 over the exact UTF-8 bytes, and stores the immutable payload in PostgreSQL. The program stores the snapshot slot, hash, investor count, wallet count, and aggregate token amount. `snapshot-v1` remains a historical test vector only.

If the snapshot window is missed, the action transitions to `SNAPSHOT_MISSED` and requires an explicit administrator decision; it must not continue using a later balance set under the original record date.

## Reasoning

This design makes the MVP independently reproducible without claiming historical capabilities the chosen infrastructure does not provide. The on-chain hash detects database payload alteration, while the retained canonical payload permits recalculation and audit.

## Consequences

- Operational scheduling around record dates is mandatory.
- Snapshot jobs must be observable and retryable within the allowed window.
- Historical snapshot support is excluded from MVP scope.
- A hash match proves payload integrity, not that the RPC provider returned a complete universe; reconciliation and provider controls remain necessary.

## Risks

- RPC degradation near the record date can cause a missed snapshot.
- Incomplete token-account enumeration could produce a self-consistent but incomplete snapshot.
- Canonicalization differences across implementations could change the hash.

## Future work

- Evaluate archival RPC or indexer support with explicit completeness guarantees.
- Add multi-provider comparison for high-value actions.
- Formalize the snapshot schema and publish cross-language test vectors.

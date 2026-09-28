# ADR-004: Solana and PostgreSQL source-of-truth boundaries

Status: Accepted
Date: 2026-09-28

## Context

The system needs queryable workflow data and user profiles while also relying on Solana for ownership and settlement. Treating both stores as equally authoritative would make conflicts ambiguous and could allow a database update to represent execution that never finalized on-chain.

## Options considered

1. Treat PostgreSQL as authoritative and periodically publish summaries to Solana.
2. Treat every field as authoritative on Solana.
3. Assign authority by fact type and reconcile PostgreSQL projections from finalized chain state.
4. Use eventual consistency without explicit conflict rules.

## Decision

Solana and Token-2022 are authoritative for token ownership, supply, program state, snapshot commitments, and execution receipts. PostgreSQL is authoritative for application identities, wallet links, workflow metadata that is not represented on-chain, the exact canonical snapshot payload, idempotency records, and query-optimized projections.

A prepared or submitted transaction is not considered complete in PostgreSQL until its signature is confirmed at `finalized` and the expected accounts are read back successfully. Reconciliation compares database projections with on-chain facts and records discrepancies; it never overwrites chain facts from the database.

## Reasoning

Authority by fact type keeps the trust model explicit. Solana provides publicly verifiable execution and ownership, while PostgreSQL provides the private and operational data that is unsuitable or inefficient on-chain. Finalized confirmation prevents optimistic API state from masquerading as completed settlement.

## Consequences

- UI states must distinguish prepared, submitted, finalized, reconciled, and failed operations.
- Database recovery must rebuild chain-derived projections from finalized accounts and receipts.
- Snapshot payload availability still depends on protected database backup even though its hash is on-chain.
- Reconciliation is a core workflow, not optional monitoring.

## Risks

- RPC lag or provider inconsistency can delay projection updates.
- A database backup loss can remove the preimage of a valid on-chain snapshot hash.
- Incorrect reconciliation logic could generate false discrepancy alerts.

## Future work

- Define recovery-point and recovery-time objectives for snapshot payloads.
- Add an independent object-store backup for immutable canonical snapshots.
- Evaluate event indexing and multiple RPC providers for production scale.

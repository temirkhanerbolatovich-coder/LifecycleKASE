# ADR-010: Bounded on-chain snapshot registration

Status: Accepted for local MVP
Date: 2026-09-30

## Context

The database can prepare canonical `snapshot-v2` bytes from a finalized Token-2022 RPC response, but an on-chain action must commit their hash and counts exactly once. The product forbids reconstructing a missed record-date snapshot. A direct program caller must not be able to register one arbitrarily late, while a Solana program cannot independently verify an RPC commitment level or the preimage of a supplied hash.

## Options considered

1. Trust the backend's time check only, leaving direct on-chain calls unbounded.
2. Accept a caller-supplied grace period, which the signer could extend.
3. Enforce a fixed 300-second on-chain upper bound matching the demo default, with the backend free to use a shorter window.
4. Add mutable configuration and governance accounts before the first snapshot instruction.

## Decision

`register_snapshot` requires an active instrument, its issuer signer, a scheduled action without a prior commitment, a nonzero hash, a nonzero past-or-current slot, positive investor/wallet/balance counts, and a supplied balance and mint supply matching the live Token-2022 mint. It accepts transactions only from `record_at` through `record_at + 300` seconds by the on-chain Clock. It writes the commitment and moves the action to `SnapshotCreated`; subsequent registration or cancellation is rejected.

The backend's `SNAPSHOT_GRACE_SECONDS` must not exceed 300. Before preparing the transaction, the backend must independently verify the RPC slot at `finalized`, its block time within the record-date window, complete verified-wallet mapping, canonical bytes and SHA-256. After submission it must wait for finalized confirmation and read back the PDA. The on-chain program does not attest those off-chain facts.

## Reasoning

The fixed on-chain bound prevents late direct calls without adding a bootstrap or mutable configuration account. The commitment is a tamper-evident reference to an off-chain payload, not proof that the payload was collected correctly.

## Consequences

- Candidate preparation and persistence reject a grace setting above 300 seconds; any future public configuration must enforce the same bound.
- Clock drift and transaction latency consume part of the 300-second window.
- After `SnapshotCreated`, correcting the source data requires a new action rather than editing the hash.
- The local validator test proves storage, guards and replay rejection, but not a real finalized-RPC investor snapshot.

## Risks

- An authorized issuer could submit a fabricated hash or slot directly; identity, canonical-preimage and RPC-finality checks must be enforced and audited in the application workflow.
- A missed window currently returns an error but does not automatically transition the action to `SnapshotMissed`; a separate terminal-state instruction or confirmation workflow is needed.

## Future work

Extend the internal unsigned instruction plan into an authenticated wallet transaction, verify the finalized transaction and action PDA before database finalization, add a missed-window terminal transition, and consider governed configuration only if a different window becomes a demonstrated requirement.

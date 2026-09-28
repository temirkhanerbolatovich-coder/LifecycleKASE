# Architecture overview

Status: Milestone 0 baseline
Last updated: 2026-09-28

## Components

| Component | Responsibility | Trust boundary |
|---|---|---|
| Next.js web | Administrator and investor workflows; wallet interaction | Untrusted client; no authoritative validation |
| NestJS API | Authentication, authorization, orchestration, canonical snapshots, transaction preparation and reconciliation | Trusted application service; never holds administrator private keys |
| Domain package | Deterministic calculations and state rules | Pure logic with no network or persistence side effects |
| Solana client package | Typed instructions, account decoding, confirmation helpers | Converts domain intent into verifiable chain operations |
| Anchor program | Enforces authority, lifecycle transitions, commitments, atomic settlement and replay protection | Authoritative execution boundary |
| Token-2022 | Bond ownership, transfers, burns, and total supply | Authoritative token ledger |
| PostgreSQL | Identity links, workflow orchestration, immutable snapshot payloads and read projections | Recoverable projection; not authoritative for chain facts |

## Primary data flow

1. The administrator starts a workflow in the web application.
2. The API validates permissions and current finalized on-chain state.
3. The API returns an unsigned transaction with expected accounts and constraints.
4. The administrator wallet signs and submits the transaction.
5. The API confirms the signature at `finalized`, reads the resulting accounts, and updates PostgreSQL projections.
6. Reconciliation detects and reports any divergence between PostgreSQL and Solana.

Snapshot construction is a special case: the API reads Token-2022 accounts at the current finalized slot, creates canonical JSON, computes SHA-256, persists the payload, and commits the hash and slot on-chain. Historical reconstruction is intentionally unsupported in the MVP.

## Authority model

The fixed-supply bond mint has zero decimals. Its mint and freeze authorities are absent after issuance. The Instrument Authority PDA is the Token-2022 permanent delegate used only by program-controlled redemption instructions. A human administrator wallet authorizes corporate actions but never shares a private key with the API.

## Failure model

- A transaction is not treated as complete until finalized confirmation and account reconciliation succeed.
- Each entitlement executes atomically in one transaction; failures leave that entitlement unexecuted.
- A corporate action may be partially executed across holders and remains resumable.
- Missing a record-date snapshot window produces an explicit failure state instead of a backdated reconstruction.

The accepted decisions are indexed in [Architecture decisions](../decisions/README.md).

The current relational model and its remaining migration-level guarantees are described in [Persistence architecture](persistence.md).

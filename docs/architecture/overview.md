# Architecture overview

Status: Milestone 0 baseline with partial Milestone 1 program and Milestone 2 client implementation
Last updated: 2026-09-30

## Components

| Component | Responsibility | Trust boundary |
|---|---|---|
| Next.js web | Read-only status dashboard implemented; administrator/auditor workflows and wallet interaction pending | Untrusted client; no authoritative validation |
| API package | Internal snapshot candidate preparation and pending PostgreSQL persistence; NestJS liveness and PostgreSQL readiness routes implemented; authentication and on-chain transaction orchestration pending | Trusted application service when deployed; never holds administrator private keys |
| Domain package | Deterministic calculations and state rules | Pure logic with no network or persistence side effects |
| Solana client package | Token-2022 holder collection and RPC boundary implemented; instructions and confirmation helpers pending | Converts finalized chain account data into validated holder balances |
| Anchor program | Instrument initialization/activation, action scheduling/cancellation, and immutable snapshot hash/slot/count registration are locally implemented; entitlement calculation and execution are pending | Future authoritative execution boundary; not deployed |
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

The implemented client collector reads all mint-filtered Token-2022 accounts at one returned finalized context slot, decodes the base token-account prefix even when extensions are present, and checks that positive balances sum to mint supply. It refuses inconsistent supply/slot responses. Internal API candidate preparation and persistence plus an on-chain snapshot commitment instruction exist, but no authenticated transaction flow connects them; a fixture-tested collector is not a live snapshot proof.

The internal API service joins that collector with Prisma action and wallet mappings, checks the configured genesis hash and record-date window, and computes canonical snapshot-v2 bytes. Its persistence step revalidates state, versions and wallet mappings in a serializable transaction, then writes the canonical payload and child rows as `PENDING_REGISTRATION`. The on-chain registration instruction exists locally, but no API transaction preparation or finalized confirmation connects it to this candidate. The only HTTP entry points are liveness and PostgreSQL readiness checks. No authenticated domain HTTP entry point exists yet.

## Authority model

The fixed-supply bond mint has zero decimals. Its mint and freeze authorities are absent after issuance. The Instrument Authority PDA is the Token-2022 permanent delegate used only by program-controlled redemption instructions. A human administrator wallet authorizes corporate actions but never shares a private key with the API.

## Failure model

- A transaction is not treated as complete until finalized confirmation and account reconciliation succeed.
- Each entitlement executes atomically in one transaction; failures leave that entitlement unexecuted.
- A corporate action may be partially executed across holders and remains resumable.
- Missing a record-date snapshot window produces an explicit failure state instead of a backdated reconstruction.

The accepted decisions are indexed in [Architecture decisions](../decisions/README.md).

The current relational model and its remaining migration-level guarantees are described in [Persistence architecture](persistence.md).

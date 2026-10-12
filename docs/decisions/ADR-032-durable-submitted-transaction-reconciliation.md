# ADR-032: Durable reconciliation of submitted financial transactions

Status: Accepted for the isolated Localnet candidate. Date: 2026-10-12.

## Context

Coupon and redemption attempts already persist exact unsigned bytes and the original signature before RPC broadcast. Interactive confirmation verifies finalized transaction bytes, receipts and cash/burn history, then atomically projects PostgreSQL settlement state and audit. A browser refresh does not lose the attempt, but no background runner resumes that verification after a process restart.

Unknown submission results must preserve their original signature. A worker must not become a wallet or bypass human approval by preparing or submitting a replacement financial operation.

## Options considered

1. Keep interactive recovery only. This leaves a finalized payment unprojected until an operator returns.
2. Add a generic execution queue with signing/broadcast. This introduces custody and new authorization decisions beyond this change.
3. Reconcile already submitted financial attempts using the existing confirmation functions, with a PostgreSQL queue and lease fencing.

## Decision

Choose option 3. A separate default-off CLI handles only `COUPON_PAYMENT`, `COUPON_FINALIZE`, `REDEMPTION_PAYMENT` and `REDEMPTION_FINALIZE` with a saved signature in `SUBMITTED` or `UNKNOWN_CONFIRMATION`. The candidate accepts explicit loopback Localnet RPC and disposable PostgreSQL names only. The normal API does not start the worker.

Migration 23 adds one reconciliation job per blockchain transaction, immutable original signature/genesis, retry schedule, attempt count and renewable-by-reclaim ownership token. A bounded sweeper inserts missing jobs after submission/queue crashes. `FOR UPDATE SKIP LOCKED` claims a job atomically; every reclaim assigns a fresh UUID token.

Existing confirmation functions keep all wire, signer, network, receipt and financial checks. Before projection, their serializable transaction locks the job row and checks the current token and unexpired lease. Settlement, business projection, audit and job completion commit together. The row lock prevents another runner from taking ownership during that commit. A stale runner can read RPC, but cannot commit projection or job completion.

The signer continues to mean the original wallet that signed the saved message. Background confirmation audit uses null user/wallet actor fields and `SYSTEM_RECONCILIATION` metadata, retaining original initiator, signer and submission-audit references. Historical signing intent can be reconciled after session expiry; the worker grants no fresh signing or administrative authority.

## Reasoning

The existing confirmation path is already the financial verification boundary. Reusing it avoids a second interpretation of payment/burn evidence. PostgreSQL is already the durable store; no broker or new dependency is needed. A dedicated job model avoids the existing execution-job model's nullable entitlement uniqueness and missing per-attempt fencing.

## Consequences and risks

- Uncertain/pruned history stays uncertain and retries the same signature with bounded exponential backoff. The worker cannot broadcast, request an airdrop, obtain a new blockhash or simulate a replacement transaction through its RPC adapter.
- Recognized RPC transport, database connectivity and serialization errors retry. Invariant failures and unexpected logic errors become `BLOCKED` with sanitized error codes. Retry exhaustion also requires operator attention.
- The original authenticated submission audit is required. Missing/mismatched audit or changed signature/genesis blocks a job.
- Lease expiry can produce repeated RPC reads. Fencing protects the commit; this narrow worker does not promise exactly one RPC read.
- Snapshot capture, issuance, funding, approval, calculation registration, cancellation/reversal, scheduled-window sweep and signing remain interactive and unsupported by this runner.
- The candidate's disposable infrastructure gate intentionally prevents an owner/hosted/Devnet rollout. Such deployment needs separate review and acceptance.

## Validation and future work

See [feature configuration and failure behavior](../features/durable-reconciliation.md) and the [dated PostgreSQL acceptance](../testing/reconciliation-worker-2026-10-12.md). Database-only tests prove durable queue/fencing/rollback behavior and do not establish on-chain financial acceptance. Full financial recovery must also run through the controlled disposable validator harness. Add broader phase adapters only after their authorization, state transitions and read-back proofs are explicitly reviewed.

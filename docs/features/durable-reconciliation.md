# Durable submitted-transaction reconciliation

This default-off Localnet candidate restores PostgreSQL settlement projections for already submitted coupon/redemption attempts. It preserves the saved operation, exact wire and original signature. It never prepares, signs, rebuilds or broadcasts financial transactions.

## Supported flow

1. The authenticated operator prepares, signs and submits through the existing workflow. Submission saves the original signature and its audit before broadcast.
2. A bounded sweeper inserts one job per signed `SUBMITTED`/`UNKNOWN_CONFIRMATION` attempt. Supported operation types are `COUPON_PAYMENT`, `COUPON_FINALIZE`, `REDEMPTION_PAYMENT`, `REDEMPTION_FINALIZE`.
3. A runner claims a due job with a persisted lease and fresh UUID ownership token. Another process can reclaim it after a crash/lease expiry.
4. The existing coupon/redemption confirmation function verifies pinned genesis, exact finalized transaction, signer, on-chain commitments, cash/burn deltas and receipts.
5. A row lock and current-lease check fence the projection. Settlement, business projection, system audit and job completion commit in the same serializable transaction.

If interactive confirmation wins first, the worker observes that saved `FINALIZED` projection and completes its job without creating another settlement. If the signature is unknown or finalized transaction history is unavailable, it remains the original attempt. `UNKNOWN_CONFIRMATION` never becomes permission to resend.

## Configuration and running

The runner is a separate process. It does not load `.env` or fall back to `DATABASE_URL`. Supply configuration explicitly to the process, then run `npm run worker:reconcile`; append `-- --once` for one tick. Build the API before invoking `node scripts/run-reconciliation-worker.mjs --once` directly.

| Variable | Default / requirement |
| --- | --- |
| `RECONCILIATION_WORKER_ENABLED` | `false`; explicit `true` enables the candidate |
| `RECONCILIATION_DATABASE_URL` | Required when enabled; PostgreSQL on an explicit loopback port, public schema, disposable name |
| `RECONCILIATION_POLL_MS` | `2000`; range 100–60000 |
| `RECONCILIATION_LEASE_MS` | `120000`; range 1000–600000 |
| `RECONCILIATION_BASE_BACKOFF_MS` | `5000`; range 100–300000 |
| `RECONCILIATION_MAX_BACKOFF_MS` | `300000`; range 100–3600000 and at least base backoff |
| `RECONCILIATION_MAX_ATTEMPTS` | `100`; range 1–10000 |

Existing `ACTION_APPROVAL_RESERVE_ENABLED`, `COUPON_EXECUTION_ENABLED` and `REDEMPTION_EXECUTION_ENABLED` must all be `true`. Existing `SOLANA_CLUSTER`, `SOLANA_RPC_URL`, `SOLANA_GENESIS_HASH`, `PROGRAM_ID` and timeout configuration remain authoritative. Controlled instruments also require the existing reviewed controlled-registry capability.

Accepted database names are `actions_test_<32 lowercase hexadecimal characters>` (the existing isolated demo harness), `lifecycle_kase_acceptance_*` and `lifecycle_kase_reconciliation_acceptance_*`. The suffix accepts lowercase letters, numbers and underscores; names must fit PostgreSQL's 63-character limit. Plain `lifecycle_kase`, remote PostgreSQL, alternate schemas and public/Devnet RPC are rejected. The connected database name and RPC genesis are checked before queue mutations. The CLI installs no service, timer or automatic startup.

`SIGINT`/`SIGTERM` stop polling after the in-flight tick and close Prisma. A killed process leaves a persisted lease; a new process resumes after expiry. Choose the lease duration longer than normal confirmation read-back time; a slow expired runner cannot commit its stale projection.

## Failure behavior and security

Jobs move `PENDING → RUNNING → COMPLETED`, or to `RETRY_SCHEDULED`/`BLOCKED`. Exponential backoff uses the database clock and is capped. Missing history and recognized RPC/database outages retry. Unrecognized internal failures, proof mismatches, missing original submission audit, changed identity and exhausted retry budget become `BLOCKED`. Only sanitized codes are stored/logged; exception text and connection credentials are never printed by the runner.

No transaction identity is replaced. A blocked job needs explicit diagnosis and operator follow-up; no automatic new financial attempt is created. The job's original signature, transaction relation and genesis are immutable in PostgreSQL. The RPC adapter permits a small list of read methods and refuses transport mutations.

Audit actor fields are null for the background observer. Finalization metadata records `SYSTEM_RECONCILIATION`, original initiator id, original submission-audit id, required signer, runner, job and lease token. Interactive confirmation retains its existing user attribution. A worker job is not an operator session or a new approval.

## Verification and limits

`node --test apps/api/dist/reconciliation-worker.test.js` checks configuration boundaries, read-only RPC, backoff, error classification, system audit and stale-lease rejection. `npm run test:reconciliation:database` requires explicit `RECONCILIATION_TEST_DATABASE_URL` pointing at a loopback disposable PostgreSQL server/base database. It creates a generated acceptance database, applies migrations, checks two-runner claims/restart fencing/atomic rollback, then drops only its generated database. It never contacts a validator and uses synthetic signature strings.

Financial chain acceptance is separate. The [dated report](../testing/reconciliation-worker-2026-10-12.md) identifies which validations actually ran. Issuance, funding, approval, capture, registration, cancellation/reversal, skipped record-date windows and unsigned operations are outside this first worker slice. Production metrics, queue UI and hosted/owner/Devnet rollout remain open. [ADR-032](../decisions/ADR-032-durable-submitted-transaction-reconciliation.md) records the boundary.

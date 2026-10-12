# Submitted-transaction reconciliation validation — 2026-10-12

Scope: default-off disposable Localnet candidate and separate PostgreSQL queue acceptance. This document does not claim owner, hosted or Devnet execution.

## Implemented

Migration 23 adds persisted per-transaction reconciliation jobs, immutable original signature/genesis, retry schedule and lease tokens. The separate CLI sweeps signed coupon/redemption payment/finalize attempts only. Existing confirmation functions retain all exact-wire/finalized receipt/cash/burn checks; their projection transaction now fences worker ownership, attributes observation to the system and completes the job atomically. Interactive actor attribution stays unchanged.

## Checks actually performed

- API/domain/client production TypeScript build passed after the worker changes.
- The focused worker suite passed **11 tests** covering default-off/target gates, wrong genesis before DB access, read-only RPC, retry cap, safe error codes, recognized-transient-vs-internal-failure distinction, system attribution and stale ownership rejection.
- Fresh `postgres:17-alpine` container bound only to loopback port `65494`; generated database `lifecycle_kase_reconciliation_acceptance_aad38695b3ce45fb`; all **23 migrations** applied. `scripts/test-reconciliation-queue.mjs` passed eight assertion groups and removed its generated database:
  - crash-between-submission-and-queue recovery and idempotent sweep;
  - two concurrent PostgreSQL clients claim the single job exactly once;
  - lease expiry and fresh-token reclaim after restart; the old token cannot project;
  - deliberately failed audit FK rolls back transaction projection and job completion together;
  - atomic completion leaves no claimable job and uses null system actor with original initiator metadata;
  - migration trigger rejects changing original signature;
  - unsigned, unsupported and foreign-genesis operations are excluded;
  - absent original submission audit blocks the job without replacing its unknown signature/status.

The PostgreSQL fixture uses synthetic signature strings and a synthetic transaction status projection. It contacts no validator and performs no financial transfer, burn or real signature verification. Earlier fixture setup attempts failed existing settlement-asset/prepared-wire guards and an overlong generated PostgreSQL name; the final harness corrects those fixtures without relaxing any existing database guard.

## Remaining acceptance

The integrated controlled validator harness must exercise this runner against genuine already submitted coupon/redemption payments and action finalization before fresh on-chain worker financial recovery is claimed. Process-kill recovery during that full workflow, RPC outage, pruned-history retry, queue metrics and operator blocked-job handling remain distinct acceptance items. This narrow slice does not implement all durable execution phases or a scheduled-window sweeper.

See [configuration and failure behavior](../features/durable-reconciliation.md) and [ADR-032](../decisions/ADR-032-durable-submitted-transaction-reconciliation.md).

# ADR-016: Action lifecycle and snapshot recovery boundary

Status: Accepted
Date: 2026-10-02

## Context

The Anchor program already schedules/cancels actions, but the dashboard required an externally created action UUID for snapshots. The accepted instrument flow proved exact Phantom signatures with trusted Localnet broadcast. Scheduling/cancellation must not create a false chain projection or conflict with immutable snapshot capture.

## Options considered

1. Create SCHEDULED rows directly and supply an action UUID to the old snapshot form.
2. Extend the existing prepare/sign/finalized pattern to actions and Localnet snapshots with persisted exact wire and safe attempt recovery.
3. Introduce backend signing/custody or a generic job engine.

## Decision

Use option 2. Audited off-chain DRAFT creation has a stable request/action UUID; repeated identical requests return the original record. SCHEDULE and CANCEL have separate persisted attempts. Database lifecycle changes follow exact finalized-message and full Action PDA term/status reconciliation. Only an untouched draft can be cancelled without a chain transaction; any snapshot blocks ordinary cancellation.

Use a partial unique index for one pending attempt per action/operation, serializable/version guards, and explicit cancellation/capture exclusion. Reuse a small transaction helper for new action and snapshot submission/recovery; preserve the accepted instrument implementation. Signed attempts resume only for confirmation regardless of blockhash/window expiry. Never automatically retry wallet mutations or bypass expired authentication.

## Reasoning

This fits the program/schema and preserves the wallet custody boundary. An explicit two-step confirmation avoids mistaking a wallet response for successful chain execution. Stable identity and recorded exact wire make lost responses inspectable. A 60-second preparation lead leaves review time without changing the on-chain 300-second snapshot grace limit.

## Consequences and risks

- No private keys or new dependencies in deployed code; Devnet remains wallet-submitted/deferred.
- Existing duplicate legacy pending snapshot attempts block the new migration until explicitly reconciled.
- Source classifications are metadata, not live external integrations.
- The MVP still uses issuer authority, not separate maker/checker/delegated approval.
- Snapshot capture shows effective finalized time independently of planned record time; missed windows are blocking errors rather than backdated snapshots.
- Explicit application timestamps for auth challenge/session creation avoid inconsistent cross-clock `created_at`/`used_at` chronology without weakening nonce/signature/expiry controls.

## Future work

Owner-controlled persistent Phantom action/snapshot acceptance, explicit missed-window transitions, immutable evidence download, approvals/entitlements, payment/burn/receipts and governance remain separate gates.

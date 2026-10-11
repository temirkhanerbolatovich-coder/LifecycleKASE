# ADR-028: Governed registry review with monotonic versions

Status: Accepted for the single-workspace local-demo slice
Date: 2026-10-11

## Context

An initial investor eligibility decision needs explicit correction/suspension/restoration, and a verified investor wallet needs temporary blocking without terminal revocation. An operator form or snapshot candidate can become stale after a status round trip such as `ACTIVE → BLOCKED → ACTIVE`. Comparing only the final status cannot detect that intervening change. Controlled database maintenance also changes registry facts outside the HTTP mutation functions.

Saved snapshots, approved obligations, signed attempts and receipts must retain their committed facts. A new version of canonical snapshot-v2 or a Solana layout change is unnecessary for detecting stale reads before initial persistence.

## Options considered

1. Compare current status/timestamps only. This misses changes restored to their earlier values.
2. Increment versions only in API functions. This does not detect controlled non-HTTP updates that omit the increment.
3. Use database-owned monotonic versions, API compare-and-set writes and transient snapshot freshness facts.
4. Introduce append-only effective-time registry history and issuer-scoped authority/locks. This is a larger authority/history design than the current local-demo slice.

## Decision

Use option 3. Migration `20261011130000_registry_review_versions` adds positive PostgreSQL integer `registry_version` columns to investors and wallets, defaulting existing/new rows to 1. BEFORE UPDATE triggers compare the effective investor profile/KYC/eligibility/lifecycle or wallet identity/mapping/network/status/verification/revocation fields. An effective change sets the version to `OLD + 1`, including direct controlled SQL. A version-only rewrite is rejected. API requests may also specify an increment; the trigger produces the same single increment rather than double counting it.

Expose versions in registry reads. New eligibility-review and temporary wallet-status routes require the affected record's `expectedVersion`, an allowed reason and an active Administrator session. They perform guarded transitions and append previous/new state/version plus actor/reason/correlation audit atomically in Serializable transactions. A stale version returns `REGISTRY_CONFLICT`; repeated/unsupported transitions fail instead of becoming implicit retries. Initial review and terminal revocation keep their separate route contracts.

During snapshot preparation, retain internal `registryFacts` for each captured wallet: IDs/mapping, status/network, exact verification/revocation timestamps, raw investor lifecycle/eligibility and both registry versions. Initial snapshot persistence compares those facts again and rejects changes before writing rows. The facts are transient; they are not included in canonical-v2 JSON, its hash input, stored snapshot rows, receipt encoding or PDA derivation. Persisted pending snapshots resume from their original commitment.

At capture, inactive investor lifecycle cannot produce eligible snapshot facts: `SUSPENDED` maps to eligibility `SUSPENDED`, and `CLOSED` to `NOT_ELIGIBLE`. Later restoration cannot grant eligibility at an earlier captured point. Current registry changes do not rewrite a snapshot, approved calculation or signed attempt. New unsigned execution checks the selected receiver's current eligibility; exact-signature confirmation preserves committed evidence.

## Reasoning

Database-owned increments cover API and controlled maintenance writes without a new service or dependency. Versions detect round trips; exact captured facts also explain which current record no longer matches. Keeping freshness metadata outside canonical-v2 preserves existing snapshot/receipt compatibility. Explicit reasons and atomic audit provide a review trail while the existing Administrator/Auditor MVP boundary remains in use.

## Consequences and risks

- Apply the migration and regenerate Prisma before running the new source. Existing registry rows start at version 1; older data gains no reconstructed historical versions.
- Handwritten internal snapshot candidates must supply `registryFacts`; already stored snapshots require no backfill.
- The browser must refresh after a saved change or stale-version conflict. A failed follow-up read locks further changes and does not replay the mutation.
- Versions cover profile/KYC changes as well as payout-facing facts, so such a change can invalidate a pending candidate even if its displayed eligibility is unchanged. This conservative rejection is intentional.
- Trigger increments and audit are transactional: rollback leaves both state and version unchanged. The integer maximum fails closed; it is not a wraparound counter.
- A version trigger is not authorization or actor audit. Privileged database writers must remain controlled; an administrator able to disable triggers is outside this application boundary.
- API registry changes cannot freeze ordinary token transfers or cancel a previously signed chain transaction. They cannot replace absent finalized chain evidence.

## Validation and future work

Focused snapshot regressions cover captured inactive lifecycle, restoration after capture, exact verification/revocation changes, version round trips and unchanged canonical structure. Registry tests cover reasons, allowed transitions, stale/concurrent requests, capture-window locking and atomic audit rollback; isolated HTTP/PostgreSQL scripts also check frozen snapshots/calculations and current receiver gates. Dated test reports record actual runs and counts.

The capture-window lock remains deliberately workspace-wide. Investor profile/lifecycle administration, issuer-scoped registry/evidence access, effective-time history and historical ownership reconstruction remain separate work. Full MVP completion, retained-owner rollout, public-network settlement and production readiness are not established by this decision.

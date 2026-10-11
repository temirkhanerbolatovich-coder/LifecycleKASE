# Data flow and evidence boundaries

Reviewed: 2026-10-11. This describes current source flows and identifies unfinished settlement paths. The [architecture overview](overview.md), [persistence model](persistence.md) and [dated audit](../PROJECT_AUDIT_2026-10-10.md) provide component, schema and earlier checkpoint details. Source behavior does not establish a new deployment or retained-owner acceptance.

## Operator authentication and registry writes

1. The browser requests an operator challenge through the fixed same-origin Next.js API rewrite.
2. The API checks authentication configuration, the exact allowed Origin, rate limits and the registered operator wallet. It creates a short-lived challenge whose message binds purpose, domain, Origin, wallet, nonce and expiry.
3. The wallet signs the login message. The API verifies Ed25519 ownership and consumes the challenge once. PostgreSQL stores nonce/session-token hashes; the browser receives an HttpOnly, SameSite=Strict session cookie with Secure enabled in production.
4. Protected requests revalidate the session wallet's current user binding, ACTIVE/verified/non-revoked status, expiry and revocation. Writes additionally validate the Administrator role and Origin. Registry changes and actor/reason/version audit are committed together. Auditor sessions can read the implemented operator views.

Operator identity and investor wallet ownership are different proofs. Investor wallet attachment remains pending until its own challenge is verified. Eligibility is an explicit synthetic Localnet review, not external KYC. See [Investor Registry](../features/investor-registry.md).

For profile correction, later eligibility review or verified-wallet block/unblock, the browser sends the chosen fixed reason and the affected investor/wallet `expectedVersion`. The API checks its current state and the workspace capture-window lock, then updates by compare-and-set in a Serializable transaction with actor audit. Profile correction accepts the complete display name/type/country/reference set and rejects stale, unchanged or closed records; its audit stores changed field names without profile values. PostgreSQL triggers advance `registry_version` on effective changes, including controlled non-HTTP writes; round trips cannot make a stale version current again. The successful UI write is followed by a fresh read. If that read fails, further changes stay locked and the POST is not replayed. Captured snapshots, approved amounts, signed bytes, Investor ID, wallet proof and lifecycle/KYC/eligibility decisions are preserved by profile writes. Investor lifecycle administration and issuer-scoped access remain open. See [ADR-028](../decisions/ADR-028-registry-review-versioning.md).

Registry reads validate the Administrator/Auditor session and return `no-store`. The list applies bounded server-side search before cursor pagination. A selected UUID deep link reads its profile independently of the current list; a separate investor-bound cursor pages every wallet without expanding list previews beyond 20. Foreign wallet cursors are rejected. The complete profile/pagination contract and current checks are linked in [Investor Registry](../features/investor-registry.md) and [profile continuation](../testing/registry-profiles-2026-10-11.md). These are single-workspace reads, not issuer-scoped tenant isolation.

## Wallet transaction lifecycle

| Step | Data and required evidence | Failure/recovery |
| --- | --- | --- |
| Prepare | API validates role, issuer, network/genesis, workflow state and finalized accounts; saves the exact unsigned wire, signer, blockhash and expiry | An expired unsigned attempt may be replaced through the guarded preparation path |
| Review/sign | Browser displays validated network, phase, signer and operation terms; the owner signs in Phantom | Changed message bytes, signer or chain are rejected; signature alone does not finalize the operation |
| Submit | Localnet API verifies the exact prepared message and Ed25519 signature; signature, submitted state and audit are saved before RPC broadcast | An ambiguous RPC result preserves the same signature as UNKNOWN; recover by confirmation rather than blind resend |
| Confirm | API fetches finalized transaction bytes, compares them with the plan and reads the expected program/token accounts at or after the transaction slot | Missing/pruned transaction evidence cannot prove success; a finalized failed transaction does not advance the business state |
| Project | Each workflow checks its account invariants, then atomically commits the attempt, entity projection and audit | Audit/database failure rolls back the projection; the signed chain transaction remains recoverable using the original attempt |

Devnet submission remains wallet-owned. The retained owner Localnet, disposable test validators, and Render staging are separate environments. Render health does not establish owner-chain evidence. See [source of truth](../decisions/ADR-004-source-of-truth.md) and [wallet workflow](../../apps/web/README.md).

## Instrument and snapshot

Issuance proceeds through MINT_SETUP → DISTRIBUTION → INITIALIZE → ACTIVATE. The phases prove both Token-2022 mints, fixed bond supply and revoked mint authority, three eligible holders with 10/20/5, and the program-owned Instrument PDA before the database becomes ACTIVE. The [persistent acceptance record](../testing/localnet-instrument-acceptance.md) is separate from disposable tests.

Corporate-action DRAFT terms are stored and audited before SCHEDULE commits their Action PDA. Snapshot capture then reads all mint-filtered Token-2022 accounts in one finalized RPC context, requires complete positive-balance coverage, maps verified wallets to investors and creates canonical snapshot-v2 JSON. Blocked/revoked holder balances remain included for supply reconciliation. Captured investor lifecycle `SUSPENDED`/`CLOSED` produces ineligible snapshot eligibility even if the raw current eligibility is `ELIGIBLE`.

The candidate also retains transient wallet/investor identity, network/status, verification/revocation timestamps, raw lifecycle/eligibility and registry versions. Persistence rereads these facts before storing its SHA-256 commitment, rows, planned record time and actual capture slot in a Serializable transaction. Changed facts fail before snapshot writes, including a change restored to the same status but with a newer version. Freshness metadata is not added to canonical-v2 or persisted receipt/PDA fields. An existing pending snapshot resumes using its stored commitment; registration and finalization never substitute current investor eligibility. REGISTER_SNAPSHOT confirmation requires exact finalized wire and matching Action PDA hash/slot before SNAPSHOT_CREATED is projected.

DEMO_CAPTURE_SLOT proves ownership at the actual finalized capture slot within the allowed window. It does not reconstruct earlier ownership at a historical record date. Missing the window blocks preparation and an explicit guarded check can project SNAPSHOT_MISSED using finalized Clock/PDA evidence, version checks and atomic audit. A background sweeper and on-chain terminal instruction remain open. See [corporate actions](../features/corporate-actions.md).

## Calculation, review and funding

The API rebuilds the immutable snapshot commitment and calculates checked integer entitlements per investor. Inputs, formula/rule versions, current eligible receiver and action version are persisted with audit. Submit/approve/reject/revision is an application workflow; APPROVED alone cannot authorize an on-chain payment. The retained owner coupon remains UNDER_REVIEW at the latest audit checkpoint.

Current eligibility review and wallet block/unblock leave the captured snapshot and approved obligation unchanged. Preparing a new selected-receiver payment rechecks current eligibility; confirmation/refund/finalization preserves the committed calculation and finalized evidence. A restored investor remains ineligible for an earlier snapshot captured as ineligible. A previously signed transaction remains recoverable by its original signature and cannot be cancelled by an API registry change.

Localnet coupon funding reads the whole-coupon budget, settlement mint, treasury and issuer SOL. It prepares only the KZT-Test deficit. Finalized confirmation verifies exact Token-2022 wire and treasury delta before updating the funding attempt and audit. Funding neither pays investors nor reserves tokens for a particular action. See [entitlements](../features/entitlements-and-review.md) and [funding](../features/coupon-funding.md).

The entitlement REGISTER/RESET/FINALIZE candidate also follows exact-wire/PDA/projection checks behind a fail-closed feature flag. The retained owner registration candidate was historically upgraded on October 9, and RESET plus three REGISTER were accepted; the signed FINALIZE remains UNKNOWN_CONFIRMATION. Owner API/RPC are unavailable in the October 10 audit, so SQL status is not fresh chain proof. See [registration boundary](../features/on-chain-entitlement-registration.md).

## Coupon and redemption settlement

The isolated default-off Localnet candidate implements separate on-chain approval, whole-action vault reserve, atomic coupon transfer/state/EntitlementReceipt, exact finalized token-delta confirmation and serializable database Cash Leg CONFIRMED / Asset Leg NOT_APPLICABLE reconciliation. A separate finalization verifies the complete paid entitlement set and commits the canonical ActionReceipt JSON hash/PDA. Receipt access is authenticated and audited.

For early/maturity redemption, REGISTER also commits the immutable snapshot source token accounts and initializes action supply progress. PAY checks current supply and committed sources, transfers KZT-Test and burns the exact bonds atomically, then records a RedemptionReceipt and progress. API confirmation uses transaction history for cash and burn deltas before projecting both required Cash/Asset Legs, circulating supply and audit together. A final receipt commits the complete result; zero remaining supply retires the instrument. Signed attempts recover only through their original signature. See [redemption flow](../features/redemption-execution-and-receipts.md) and [runtime acceptance](../testing/kase-three-actions-2026-10-10.md). Owner installation/acceptance remain separate.

The independent [Telegram watchdog](../features/telegram-monitoring.md) reads health/RPC/optional aggregate facts and stores ignored notification state. It cannot sign, approve, pay or repair financial state. Durable execution jobs and automatic reindex/reconciliation remain open in the [delivery checklist](../deployment/DEVNET_TO_MVP_CHECKLIST.md).

# Data flow and evidence boundaries

Reviewed: 2026-10-09. This describes implemented flows and identifies unfinished settlement paths. The [architecture overview](overview.md), [persistence model](persistence.md) and [current audit](../PROJECT_AUDIT_2026-10-09.md) provide component, schema and checkpoint details.

## Operator authentication and registry writes

1. The browser requests an operator challenge through the fixed same-origin Next.js API rewrite.
2. The API checks authentication configuration, the exact allowed Origin, rate limits and the registered operator wallet. It creates a short-lived challenge whose message binds purpose, domain, Origin, wallet, nonce and expiry.
3. The wallet signs the login message. The API verifies Ed25519 ownership and consumes the challenge once. PostgreSQL stores nonce/session-token hashes; the browser receives an HttpOnly, SameSite=Strict session cookie with Secure enabled in production.
4. Protected writes validate the session, Administrator role and Origin. Registry changes and actor/reason/version audit are committed together. Auditor sessions can read the implemented operator views.

Operator identity and investor wallet ownership are different proofs. Investor wallet attachment remains pending until its own challenge is verified. Eligibility is an explicit synthetic Localnet review, not external KYC. See [Investor Registry](../features/investor-registry.md).

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

Corporate-action DRAFT terms are stored and audited before SCHEDULE commits their Action PDA. Snapshot capture then reads all mint-filtered Token-2022 accounts in one finalized RPC context, requires complete positive-balance coverage, maps verified wallets to investors and creates canonical snapshot-v2 JSON. The API stores its SHA-256 commitment, rows, planned record time and actual capture slot in a serializable transaction. REGISTER_SNAPSHOT confirmation requires exact finalized wire and matching Action PDA hash/slot before SNAPSHOT_CREATED is projected.

DEMO_CAPTURE_SLOT proves ownership at the actual finalized capture slot within the allowed window. It does not reconstruct earlier ownership at a historical record date. Missing the window blocks preparation; automatic SNAPSHOT_MISSED transitions remain open. See [corporate actions](../features/corporate-actions.md).

## Calculation, review and funding

The API rebuilds the immutable snapshot commitment and calculates checked integer entitlements per investor. Inputs, formula/rule versions, current eligible receiver and action version are persisted with audit. Submit/approve/reject/revision is an application workflow; APPROVED alone cannot authorize an on-chain payment. The retained owner coupon remains UNDER_REVIEW at the latest audit checkpoint.

Localnet coupon funding reads the whole-coupon budget, settlement mint, treasury and issuer SOL. It prepares only the KZT-Test deficit. Finalized confirmation verifies exact Token-2022 wire and treasury delta before updating the funding attempt and audit. Funding neither pays investors nor reserves tokens for a particular action. See [entitlements](../features/entitlements-and-review.md) and [funding](../features/coupon-funding.md).

The entitlement REGISTER/RESET/FINALIZE candidate also follows exact-wire/PDA/projection checks behind a fail-closed feature flag. Its disposable acceptance does not mean the retained owner program has been upgraded. See [registration boundary](../features/on-chain-entitlement-registration.md).

## Remaining settlement flow

On-chain action approval, action-specific reserve, coupon execution, atomic redemption payment/burn, receipts and full Cash/Asset Leg reconciliation are pending. The intended evidence chain is approved calculation → governed funded action → finalized entitlement operation → matching cash/asset facts → verifiable action receipt. None of those later states may be inferred from a funded treasury, a submitted signature, a health response or an application-only approval.

The independent [Telegram watchdog](../features/telegram-monitoring.md) reads health/RPC/optional aggregate facts and stores ignored notification state. It cannot sign, approve, pay or repair financial state. Durable execution jobs and automatic reindex/reconciliation remain open in the [delivery checklist](../deployment/DEVNET_TO_MVP_CHECKLIST.md).

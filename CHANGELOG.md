# Changelog

## Investor profiles, server search and full wallet history — 2026-10-11

- Add authenticated profile detail and bounded wallet pages, server-side investor search and selected-profile deep links beyond the list's 20-wallet preview.
- Add Administrator full-profile correction with fixed reason, expected version, capture lock and atomic audit of changed field names; reject stale, unchanged, duplicate-reference and closed-profile writes.
- Preserve stable IDs, lifecycle/KYC/eligibility, verified mapping and immutable financial obligations. Reuse migration 20 and ADR-028; no program change or lifecycle closure is added.
- Set investor-ownership challenge creation/expiry from one API timestamp, matching the existing operator-login flow, to prevent small API/database clock differences from violating the temporal SQL guard; retain the guard and one-time consumption contract.
- Validate country input as two raw ASCII letters before uppercasing, so Unicode case expansion cannot introduce an unintended country code.
- Add RU/EN profile forms and corresponding page-local QA behavior, preserving failed-write/locale form state and requiring refresh after a saved mutation. See [phase evidence and remaining work](docs/testing/registry-profiles-2026-10-11.md). Source publication, CI and hosted rollout retain separate checkpoints.

## Governed investor eligibility and temporary wallet blocking — 2026-10-11

- Add reasoned review of existing demo eligibility decisions and reversible blocking of verified investor wallets, with Administrator writes and Auditor reads.
- Require the loaded registry version, reject stale/concurrent changes and preserve terminal revocation and wallet ownership evidence. Database triggers version direct maintenance changes as well as API transitions.
- Reject snapshot candidates whose captured registry facts changed, including block/unblock and suspend/restore round trips; keep canonical snapshot-v2 and signed recovery evidence unchanged.
- Add RU/EN operator forms and equivalent page-local QA flows, explicit confirmation and refresh locks after a saved mutation. See [acceptance and remaining work](docs/testing/registry-governance-2026-10-11.md) and [ADR-028](docs/decisions/ADR-028-registry-review-versioning.md).
- Publish exact application commit `8ea7a42cc13b27c40fc4b3d2c4562a249a4fc02f` on both existing Render services after successful CI. Migration 20 applied; public health/protected routes and synthetic registry/Auditor browser flows passed. [Deployment evidence](docs/deployment/render-staging.md).

## Public walletless QA and English release — 2026-10-11

- Publish API/web commit `1e6c96dd119f32cbf01cecef028723b9134ebe4b` on the existing free Render services after all three CI jobs passed.
- Verify public `/qa`, RU/EN selection, issuer/approver/Auditor roles and a complete simulated coupon/receipt flow. Public health returns 200; protected routes still return 401. Record exact deployment and browser evidence in [Render staging](docs/deployment/render-staging.md).
- Keep page-local QA data isolated; no retained-owner program upgrade, real financial execution, new narrated media or final submission is performed.

## Submission candidate fixes and English UI — 2026-10-11

- Revalidate the operator wallet mapping on every session read; blocked, revoked, unverified, deleted or reassigned wallets invalidate existing sessions through `SESSION_INVALID`.
- Preserve zero-rounded coupon rows on-chain as `NotEligibleZeroRounding`; require positive calculation totals before review/finalization. Add mixed/all-zero API, program and disposable validator regressions.
- Add typed RU/EN display catalogs, a persistent language selector, matching server metadata, exact BigInt amounts and state-preserving notice translation. Fix page overflow at a 320px viewport with a vertical scrollbar.
- Add fresh three-action evidence, an English reviewer guide and the founder's verified-input profile. See [candidate acceptance](docs/testing/submission-readiness-2026-10-11.md). Owner deployment, narrated videos and final submission remain separate gates.

## Audit and submission/localization plans — 2026-10-11

- Record fresh source/test/GitHub/UI checks, two unresolved defects, public QA publication gap and prioritized implementation/acceptance backlog in the [full audit](docs/PROJECT_AUDIT_2026-10-11.md).
- Correct four current documentation contradictions while preserving historical checkpoints. Add the [RU/KK/EN localization plan](docs/features/localization-plan.md) and [English demo/pitch narration](docs/submission/ENGLISH_DEMO_AND_PITCH_PLAN.md). No application-code fix, localization implementation, new video, deployment or submission is claimed.

## Walletless UI QA — 2026-10-11

- Add a page-local `/qa` sandbox with shared operator screens, synthetic records, issuer/approver/Auditor switching, explicit simulated three-action stages and marked state export/reset. Preserve protected wallet authentication and real signing validation. See the [QA checklist and limits](docs/features/qa-sandbox.md); implementation and deployment acceptance are tracked separately.

## Public application staging — 2026-10-11

- Publish API and web from exact application revision `bc62abfd947db6bc854624dccdcac61ec13036a3` on the existing free Render services, with successful migration 19 and startup logs.
- Verify API live/ready, web live/dashboard and protected journal routes through both API and web origins. Keep wallet access controls and retained-owner Solana acceptance separate.
- Add the verified [public dashboard](https://lifecyclekase-web.onrender.com/dashboard) to the submission draft and synchronize the [deployment evidence](docs/deployment/render-staging.md).

## Submission preparation — 2026-10-11

- Add a current-only KASE requirements matrix and the nine-field official submission draft with the UTC deadline and owner-confirmed pending Colosseum project submission.
- Add an English-captioned presentation copy and a repeatable local captioning script. Preserve the original Auditor recording and exact financial receipts.
- Keep simulated inputs, effective capture cutoff, disposable Localnet and human-controlled final submission explicit in judge-facing materials.

## Unreleased — isolated Localnet candidate, 2026-10-10

- Add atomic partial and maturity redemption: immutable source accounts, supply progress, Token-2022 payment/burn, per-entitlement receipts and final action receipts.
- Extend reviewed funding, separate approval/reserve and operator workflows to all three corporate-action types behind an independent default-off redemption flag. Preserve existing routes, database migrations and persisted account layouts.
- Add exact browser wire checks, required cash/asset reconciliation, original-signature recovery, safe zero-supply retirement and responsive read-only redemption evidence.
- Add the reproducible disposable three-action demo and optional real-browser video capture, with source-shortage, program rollback, replay, tampered-wire and audit/history recovery checks.
- Fix reviewed-source comparison after PostgreSQL JSONB reorders keys, and make signed funding submissions confirmation-only.
- Synchronize architecture, security, testing, audit, compliance and submission documentation. See [acceptance](docs/testing/kase-three-actions-2026-10-10.md) and [ADR-025](docs/decisions/ADR-025-atomic-redemption.md).

This source release does not install or enable the candidate on the retained owner ledger. Public-network, real integrations and production acceptance remain separate.

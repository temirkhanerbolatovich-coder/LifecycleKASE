# Governed registry continuation — 2026-10-11

This is the earlier eligibility/wallet governance acceptance checkpoint. Later governed profile correction, detail/deep links, server search and full wallet pagination are recorded in [profile continuation](registry-profiles-2026-10-11.md). Its checks/publication are separate from the results and source SHA below.

This phase continues the approved product/technical requirements from application/documentation checkpoint `aae2ecf35c9a87fe01abf9098deecce0fdf5b0dd` on `codex/full-project-audit-20261010`. It closes existing eligibility correction/suspension/restoration and temporary verified-wallet blocking. It does not claim completion of the entire specification.

## Implemented behavior

| Requirement | Result and evidence boundary |
| --- | --- |
| Governed eligibility changes | Administrator can review an existing `ELIGIBLE`, `NOT_ELIGIBLE` or `SUSPENDED` decision with a fixed reason and loaded version. Initial pending review remains a separate workflow. `ELIGIBLE` restoration requires an active verified wallet. |
| Temporary wallet blocking | Verified investor wallets can change `ACTIVE ↔ BLOCKED`; terminal revocation and pending ownership proof remain separate. Ownership, network and verification evidence are preserved; operator-linked wallets cannot use this endpoint. |
| Immutable audit | Both new transitions append actor, correlation, reason, previous/new state and versions atomically. Audit failure rolls back the mutation and version. |
| Stale forms and concurrent writes | Monotonic Investor/Wallet versions and compare-and-set updates reject stale and concurrent requests, including suspend/restore or block/unblock round trips. Direct controlled database fact changes also advance versions exactly once. |
| Capture correctness | The existing workspace-wide capture lock applies to the new transitions. Snapshot persistence rechecks transient registry facts and versions. Inactive investor lifecycle cannot become eligible in the captured commitment; later restoration does not rewrite it. Canonical snapshot-v2 encoding/hash algorithm, already captured commitments, signed transaction formats and program layouts are unchanged. New candidates reflect the corrected inactive-lifecycle eligibility and therefore can have different JSON/hash values. |
| Current receiver gate | Actual entitlement service checks reject a newly prepared execution after suspension/blocking. Finalized snapshots and approved amounts remain unchanged. Registry edits cannot cancel an already signed blockchain transaction; original-signature confirmation remains the recovery path. |
| Operator usability | RU/EN controls distinguish review, reversible blocking and terminal revocation. Mandatory reason and explicit confirmation precede each change. Rejected writes preserve choices; a saved write locks further changes until a newer record is read. |

The MVP uses the Administrator/Auditor allowance in [product requirements section 3.3](../requirements/PRODUCT_REQUIREMENTS.md). Investor lifecycle `status` administration is distinct from changing `eligibilityStatus`; this phase does not introduce profile edit/close or lifecycle suspension endpoints.

## Validation

- API build and focused registry/controller/wallet tests passed; focused and related snapshot tests passed (40 tests).
- Full Node test suite passed: **378 tests** (155 API / 95 web / 27 domain / 54 Solana client / 47 repository). Prisma schema validation, scaffold and Markdown links passed. The production dependency audit reported zero vulnerabilities.
- Production Next.js build and the same-origin proxy integration passed in a dedicated app copy. The two new routes preserve Origin, body and Strict HttpOnly session cookies; unknown routes do not reach the backend.
- A separate loopback-only PostgreSQL 16 container on port 55441 applied all **20 migrations**. SQL guards and all four existing HTTP/PostgreSQL runners passed: snapshot persistence, registry, corporate actions and program-upgrade recovery. Each HTTP runner creates and drops only its uniquely named test database.
- New real HTTP/database checks passed: role/Origin/input limits, pending/revoked/foreign boundaries, initial ownership proof, reasons/audit, concurrent review/status races, ABA rejection, current receiver eligibility, immutable snapshot/calculation, injected audit-insert rollback, capture lock and additive version reads.
- Direct SQL trigger regressions passed: fact change increments once, reverse change increments once, no-op retains its version, and version-only writes fail atomically for both Investor and Wallet.
- The retained owner database, validator, wallet and program were not modified. No Rust/SBF or real chain transaction was required for this registry-only implementation; the earlier three-action validator evidence retains its separate revision/date.

The generated Next development/production route types in a reused `.next` directory can duplicate `LayoutProps`. A source-scoped web TypeScript check and clean production-copy build both passed. This generated-artifact issue is separate from application source diagnostics.

## Browser usability checks

The local walletless QA was checked in RU and EN at desktop and 390 × 844 viewport sizes. Mandatory reasons, language-change form retention, explicit confirmations, preserved inputs after an injected failed write, eligibility suspend/restore and wallet block/unblock passed. A final sequence retained Investor version **3** through Wallet version **1 → 2 → 3**. Auditor controls remained read-only; the 390 px viewport had no document horizontal overflow. Console error/warning capture was empty. Screenshots: [final versions](evidence/registry-governance-2026-10-11/final-versions-en.png), [mobile blocked wallet](evidence/registry-governance-2026-10-11/mobile-blocked-en.png), [mobile Auditor](evidence/registry-governance-2026-10-11/mobile-auditor-en.png), [desktop English](evidence/registry-governance-2026-10-11/desktop-registry-en.png), [desktop Russian](evidence/registry-governance-2026-10-11/desktop-registry-ru.png).

Next Fast Refresh exposed an unintended QA fixture reset during source edits. The initialization effect now preserves an existing sandbox; explicit reset and full reload still create a fresh fixture. Model regressions and the final browser sequence passed after this correction. Physical browser JSON download was not accepted as tested: the automation did not receive a download event. JSON export structure is covered by existing model tests. Keyboard, zoom, screen-reader and real-operator task acceptance remain separate.

## Remaining specification work

1. Issuer-scoped registry, canonical snapshot/receipt and evidence access; explicit membership and controlled operator lifecycle. The present registry/capture lock serves one demo workspace.
2. Investor lifecycle suspension/closure, governed by holdings, live actions and unresolved signed attempts. Profile edit, independent detail/deep links, server search and full wallet pagination are implemented in the later [profile continuation](registry-profiles-2026-10-11.md); that does not close lifecycle governance or issuer isolation.
3. Durable missed-window processing, restart/reindex and unknown-signature tooling; governed pause/resume, authority changes and reserve recovery.
4. Reasoned terminal policy for all-zero calculations, without manufacturing settlement or rewriting snapshot evidence.
5. Kazakh catalog and native financial terminology review; keyboard, zoom and screen-reader acceptance plus observed operator tasks. English UI exists; actual narrated demo/pitch videos and final Colosseum submission remain human deliverables.
6. Separately reviewed retained-owner and public-network wallet/financial acceptance, holder-scale limits, supervision/metrics and backup/restore drills. Historical ownership reconstruction and real KYC/custody/fiat/exchange integration remain separate pilot scope.

Implementation/configuration details are in [Investor Registry](../features/investor-registry.md), [ADR-028](../decisions/ADR-028-registry-review-versioning.md) and the [QA sandbox](../features/qa-sandbox.md). Source publication, CI and application rollout are separate checkpoints; [Render staging](../deployment/render-staging.md) records the deployed revision.

## Source publication

Application commit [`8ea7a42cc13b27c40fc4b3d2c4562a249a4fc02f`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/commit/8ea7a42cc13b27c40fc4b3d2c4562a249a4fc02f) is pushed on `codex/full-project-audit-20261010`, in [draft PR #1](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/pull/1). All three jobs in [CI run 38149599630](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38149599630) passed: repository checks (clean builds, full typecheck/tests, production proxy and all SQL/HTTP suites), program checks (both Rust profiles/formatting/Clippy) and full-history secret checks. Local staged and full-history Gitleaks scans also passed. The temporary registry test PostgreSQL container was stopped after acceptance. `master` remains `27af655bc3b0354ad067778fed8ebd0e68c61a64`; this publication does not merge the PR or submit to the hackathon.

Both existing Render services are Live at this same application SHA, and their API build applied migration 20 successfully. [Public HTTP observations](evidence/registry-governance-2026-10-11/public-http.json) verify health/readiness/QA and protected registry routes; a signed-out English QA passed all four registry transitions and read-only reason/version audit with no browser errors/warnings. See [Render staging](../deployment/render-staging.md) for deploy IDs, times, screenshots and the separate financial/authenticated staging acceptance boundaries.

# Investor profiles, detail and search — 2026-10-11

This continuation starts from `836570b05b0db1f47d7b963ca25c2075aa2cf874` on `codex/full-project-audit-20261010`. It implements the required authenticated investor detail and bounded list contracts, extends governed registry versions to profile editing and removes the twenty-wallet browsing limitation. It does not close the entire product/technical specification.

## Implemented

| Requirement | Behavior |
| --- | --- |
| Investor detail | Administrator/Auditor `GET /investors/:id` returns current profile, version, count and an explicitly bounded wallet preview. UI reads by selected UUID, including deep links outside the loaded list. |
| Full wallet browsing | `GET /investors/:id/wallets` returns bounded pages of all mapped wallets, including pending, verified, blocked and revoked records. Cursor ownership is checked against the route investor. |
| Registry search | Name/reference search ignores case; Solana wallet-address search preserves case; UUID search matches the stable investor ID. The query is validated and applied before pagination. Database-level cursor comparisons preserve PostgreSQL timestamp precision. |
| Profile correction | Administrator submits all four profile fields, current version and a fixed reason. Empty UI reference clears it with explicit `null`; identity, KYC, eligibility, lifecycle, wallet mapping and on-chain ownership are unchanged. Closed profiles reject edits. |
| Concurrency and audit | Serializable compare-and-set rejects stale, competing and no-op writes. Actor/correlation audit commits atomically and stores changed field names, reason and versions rather than profile contents. |
| Snapshot safety | Existing capture lock and profile-aware database version trigger apply. Captured snapshot bytes/rows, approved amounts, wallet proof and original signed attempts are preserved. |
| Operator UI | RU/EN form, explicit confirmation, retained rejected drafts and saved-write refresh lock. Draft versions remain bound to the facts originally edited; a changed record requires an explicit draft replacement. Refresh reads the selected record and already opened wallet pages rather than depending on the first list page. Superseded requests are cancelled and retain the shared 15-second request timeout. |

The existing twenty migrations already version profile fields; no migration, program change, dependency, role expansion or new architectural layer is required. [ADR-028](../decisions/ADR-028-registry-review-versioning.md) remains the governing decision.

## Validation record

The final local `npm run check` passed **397 tests**: API 162, web 107, domain 27, Solana client 54 and root integration/configuration 47, with scaffold/document links, Prisma validation and all workspace type checks passing.

| Check actually run | Result and boundary |
| --- | --- |
| Twenty Prisma migrations and `test/database-guards.sql` | Passed on a disposable PostgreSQL 16 container bound to loopback port 55442. SQL guard scenarios roll back their fixtures. |
| `npm run test:registry:database` runner | Passed real HTTP/PostgreSQL authentication, role/Origin, strict input, 25-wallet pagination, scoped cursors, search before pagination, microsecond timestamp ties, profile concurrency/ABA/no-op/conflicts, capture locks, atomic audit rollback/privacy and immutable synthetic financial fixtures. The final invocation used `node scripts/test-investor-registry.mjs` after the API build completed. |
| `npm run test:api:database` | Passed real snapshot persistence, nested rows, compare-and-set and duplicate rejection. |
| `npm run test:actions:database` | Passed entitlement, approval, reserve, uncertainty/no-resend, concurrency, rollback and maintenance-lock regression scenarios. RPC/financial fixtures are synthetic. |
| `npm run test:upgrade:database` | Passed durable upgrade persistence, locking, signed-attempt recovery, no rebroadcast and atomic audit. RPC evidence is synthetic. |
| `npm run test:web:proxy` | Passed a fresh production Next.js build plus Origin/body forwarding, Strict HttpOnly cookies, profile/detail/search routes and unknown-route isolation. |
| `npm audit --omit=dev` and `docker compose config --quiet` | Zero production dependency vulnerabilities reported; Compose configuration accepted. |
| Gitleaks 8.30.1, redacted full Git history and staged diff | Passed with 85 historical commits and the intended staged source/documents scanned; no leaks found. `git diff --check` and staged whitespace checks passed. |

After the final documentation and screenshot update, `npm run validate` passed the repository scaffold and all 104 Markdown files. Temporary web and PostgreSQL test processes were stopped after validation.

The database runners create and remove their own uniquely named databases. Neither retained owner records nor signing keys were used. During repeated registry acceptance, immediate proof exposed a two-millisecond difference between the PostgreSQL default clock and the application clock. Wallet challenges now explicitly persist their application creation timestamp, matching expiry/consumption; regression fixtures model a faster database clock without relaxing timestamp guards. ASCII country validation also rejects Unicode values that expand into two uppercase ASCII letters.

Browser inspection used the fresh production build at `/qa#investors?selected=…`. Independent deep-link detail, EN → RU retention of entered profile fields and the Auditor read-only presentation were observed. [English profile form](evidence/registry-profiles-2026-10-11/profile-en.png) and [Russian Auditor detail](evidence/registry-profiles-2026-10-11/auditor-ru.png) show the isolated simulation. The browser tool stalled at the standard `window.confirm` dialog; browser save/failure injection was **not accepted** in this run. Profile success/failure, conflicts and rollback passed the separate web model and real HTTP/PostgreSQL suites. Specific device widths, keyboard/zoom/screen-reader tasks and real Phantom profile editing were not newly accepted.

No Rust/program source changed, and the Rust suites or chain scenario were not rerun locally for this continuation. Source publication does not establish a new Render rollout, chain settlement, owner acceptance or production readiness.

## Source publication

The continuation targets the existing `codex/full-project-audit-20261010` branch and [draft PR #1](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/pull/1). Remote SHA and CI are checked after the source push. The earlier hosted `8ea7a42` release remains a separate deployment checkpoint; this continuation does not deploy or merge the branch.

## Remaining specification work

1. Issuer membership/isolation for registry and private evidence, full role matrix and controlled operator lifecycle.
2. Investor lifecycle suspension/restoration/closure with explicit holdings, live-action and unresolved-signature policy; registry export.
3. Durable missed-window processing, restart/reindex and confirmation-only unknown-signature tooling; governed instrument pause/resume, authority changes and reserve recovery.
4. Reasoned terminal policy for an all-zero calculation. Current behavior safely blocks submission/reserve/payment and retains the calculation.
5. Kazakh catalog/native terminology review, keyboard/zoom/screen-reader acceptance and observed operator tasks; narrated English pitch/demo and final hackathon submission.
6. Separately approved retained-owner/Phantom and public-network financial acceptance; scale limits, supervised operations, metrics and backup/restore drills.

Historical ownership reconstruction, real KYC/custody/fiat and KASE/CSD integration remain separate pilot scope. The three isolated financial scenarios retain their earlier [chain acceptance](kase-three-actions-2026-10-10.md); registry tests do not establish new blockchain settlement evidence.

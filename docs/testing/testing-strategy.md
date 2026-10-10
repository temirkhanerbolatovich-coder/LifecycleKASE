# Testing strategy and acceptance levels

Fresh October 10 results: 295 Node tests (117/55/27/49/47), all production builds/proxy, isolated SQL/persistence/registry/actions/upgrade suites, both Rust profiles (12 tests each), Rustfmt/Clippy and isolated coupon SBF build pass. Root production audit: 0; legacy integration-tool audit: 12 (5 high/7 moderate). Runtime and publication checkpoints are recorded separately in the [current audit](../PROJECT_AUDIT_2026-10-10.md).

Reviewed: 2026-10-10. Commands below define repeatable checks; dated results belong in acceptance records and the [current audit](../PROJECT_AUDIT_2026-10-10.md). A test pass proves only the exercised behavior and environment.

## Validation layers

| Layer | Command or procedure | What it establishes |
| --- | --- | --- |
| Repository | `npm run validate` | Required files, accepted base ADRs, local Markdown links and fence balance |
| Pure/unit contracts | `npm run check` | Prisma schema validation, workspace type checks and Node tests for formulas, decoders, workflow guards, auth, recovery and UI helpers |
| Production web build | `npm run build:web` | Domain/client dependencies built before Next.js; reproducible service build command |
| All production workspaces | `npm run build` | API and web compile with current dependency graph |
| Web transport | `npm run test:web:proxy` | Production same-origin proxy preserves operator transport boundaries |
| Dependency audit | `npm audit --omit=dev` | Known advisories in the root deployed graph at scan time |
| Secret scan | `gitleaks git . --log-opts="--all" --redact=100 --no-banner --ignore-gitleaks-allow` | Default scanner rules over available Git history with narrowly reviewed public-address exceptions |
| Database guards | `npm run test:database` | SQL constraints, immutability and rollback against a configured isolated database |
| API persistence | `npm run test:api:database` | Snapshot HTTP/persistence behavior using a uniquely named disposable database |
| Registry | `npm run test:registry:database` | Real authentication/role/Origin/ownership, concurrency, audit rollback and logout |
| Corporate actions | `npm run test:actions:database` | Action, calculation/review and funding database/HTTP boundaries; missed-window and signed on-chain REGISTER/RESET/re-register/FINALIZE checks use controlled RPC fixtures with real PostgreSQL, including concurrency/replay/recovery and audit rollback |
| Upgrade maintenance | `npm run test:upgrade:database` | Generated PostgreSQL database, signed synthetic RPC, durable lock, expiry, concurrent submit, lost-response recovery and audit rollback; real-validator variant is in the [feature runbook](../features/program-upgrade-maintenance.md) |
| Coupon execution and receipts | Set `APPROVAL_HTTP_ACCEPTANCE_ONLY=true`, `COUPON_ACCEPTANCE=true`, then run the disposable validator harness with the reviewed coupon artifact as shown in [acceptance](coupon-execution-2026-10-10.md) | Real 500/1000/250 transfers, exact browser/API instructions, immutable receipts, two-leg reconciliation, canonical JSON/hash/PDA, roles/Origin, same-signature recovery and atomic audit rollback; never imports the owner `.env` |
| Rust host logic | Pinned Rustfmt, both profile tests and both Clippy profiles below | Program compilation/logic/identity and linting; does not execute SBF in a validator |
| Solana runtime | Isolated build and `npm run test:solana:integration` | Actual instructions/accounts/Token-2022 behavior in a disposable validator |
| Owner acceptance | Reviewed Phantom flow plus finalized RPC/account/database/audit read-back | Only the specific retained-ledger operation actually signed and reconciled |

## Standard repository check

From the repository root with Node.js 22+ and installed lockfile dependencies:

```powershell
npm ci
npm run build:web
npm run check
npm audit --omit=dev
npm run build
npm run test:web:proxy
docker compose config --quiet
```

On a clean checkout, run `build:web` before tests/typecheck can generate workspace `dist` output. CI follows that order to catch the Render dependency-order regression. The same root command is used by the checked-in Render Blueprint. Saved Render settings and actual deployed SHA still require independent verification.

Gitleaks 8.30.1 is a separate developer/CI binary, not a production npm dependency. Obtain the appropriate [official release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), verify its published checksum and run the scan above. Use a full-history checkout; shallow history cannot prove earlier commits were scanned. Keep output redacted, and never publish unredacted reports. The scanner does not inspect ignored local credentials. See [security model](../security/security-model.md).

## Database and runtime isolation

The API/registry/action scripts create, migrate and drop uniquely named synthetic test databases, ignore `.env` and require a local PostgreSQL account allowed to create databases. `test:database` executes directly in the Compose postgres service and ignores DATABASE_URL. Use a dedicated disposable Compose project or pipe the guard SQL to a newly created container; never run it against the populated owner service. See [persistence](../architecture/persistence.md) for migration and guard constraints.

Runtime instructions, port/profile options and toolchain pins are in the [Solana toolchain runbook](../development/toolchain.md). The integration harness uses disposable keys and ledgers; Devnet profile selects artifacts rather than a remote network. A retained-to-candidate loader upgrade is tested using the [owner upgrade package procedure](../deployment/owner-localnet-program-upgrade.md), preserving the original owner environment.

The [approval/reserve acceptance](action-approval-reserve-2026-10-09.md) adds exact client/browser wire tests, real HTTP/PostgreSQL with controlled RPC, focused real custody/replay/authority/refund tests and live HTTP/DB/validator acceptance. The explicit `APPROVAL_ACCEPTANCE_ONLY` and `APPROVAL_HTTP_ACCEPTANCE_ONLY` test modes require a reviewed candidate; the latter also needs the safe base `ACTION_TEST_DATABASE_URL`. Production proxy tests build a dedicated ignored app copy, so running owner `.next` output is preserved. Browser fixtures prove controls/rendering, never owner approval or payment.

Inside the supported WSL toolchain, run:

```bash
cargo +1.98.1 fmt --all -- --check
cargo +1.98.1 test -p lifecycle_kase --locked
cargo +1.98.1 test -p lifecycle_kase --locked --features devnet
cargo +1.98.1 clippy -p lifecycle_kase --all-targets --locked -- -D warnings
cargo +1.98.1 clippy -p lifecycle_kase --all-targets --locked --features devnet -- -D warnings
```

Host tests do not replace SBF compilation or validator execution. The isolated legacy Anchor/web3 integration dependency graph has 12 known advisories at the prior audit; it must remain restricted to trusted disposable local RPC and excluded from Render/root dependencies until replaced.

Long-running runtime tests must refresh a finalized capture slot after an awaited transaction rather than reuse a pre-transaction slot: disposable validator history can be pruned during confirmation. The October 10 full audit reproduced this in direct approval acceptance and corrected the stale-slot read. The complete retained-to-current-candidate runtime suite then passed with exit 0, including second-action custody/refund/approval/replay and 34/35 rejection. The earlier failing run remains a failure even though its loader/maintenance groups passed. See the [audit evidence](../PROJECT_AUDIT_2026-10-10.md).

## Critical acceptance assertions

- Authentication: wrong Origin, replay, expired/revoked session, Auditor write and non-issuer operation are rejected server-side.
- Transactions: wrong network/signer, changed message, expired unsigned plan, ambiguous broadcast, finalized failure and missing historical bytes cannot produce false success.
- Persistence: concurrency/version conflicts, audit failure and tampered snapshot/calculation roll back atomically; confirmation is idempotent.
- Chain: exact prepared finalized wire, correct account owner/PDA/mints, slot floor, supply/balances/counters and expected deltas match before a projection changes.
- Settlement: coupon execution/receipts now use disposable-validator plus HTTP/PostgreSQL acceptance; redemption remains pending. Verify that payment/burn/receipt update is atomic, double execution is rejected, incomplete/mismatched Cash/Asset Legs block finalization, and post-snapshot transfer cannot pay without the required burn.

Add regression tests for meaningful bugs at the layer that exposes their cause. Prefer behavioral assertions; a test that merely copies implementation logic or matches source text cannot prove a financial workflow.

## CI coverage and unfinished acceptance

[GitHub CI](../../.github/workflows/ci.yml) runs full-history secret scanning, Rustfmt/tests/Clippy for both profiles, clean service-order web build, repository checks, deployed dependency audit, workspace builds, proxy/Compose checks and disposable PostgreSQL suites. Documentation validation requires the data-flow, security and testing documents to remain present.

Separate pending gates: JS lint/format tooling, SBF/runtime validator CI, complete browser Administrator/Auditor routes and error/reload cases, persistent owner entitlement FINALIZE/funding, governed owner coupon payout/receipt acceptance, early/maturity redemption and its receipts/reconciliation, restart/reindex and public Devnet acceptance. The owner upgrade, RESET and three registrations are accepted; expired signed FINALIZE remains UNKNOWN_CONFIRMATION for checking at owner request in [the owner record](owner-entitlements-2026-10-09.md). See the [delivery checklist](../deployment/DEVNET_TO_MVP_CHECKLIST.md). Existing screenshots, CI health and disposable tests do not close these gates.

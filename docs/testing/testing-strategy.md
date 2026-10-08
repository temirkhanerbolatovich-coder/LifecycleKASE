# Testing strategy and acceptance levels

Reviewed: 2026-10-09. Commands below define repeatable checks; dated results belong in acceptance records and the [current audit](../PROJECT_AUDIT_2026-10-09.md). A test pass proves only the exercised behavior and environment.

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
| Corporate actions | `npm run test:actions:database` | Action, calculation/review and funding database/HTTP boundaries |
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

The API/registry/action scripts create, migrate and drop uniquely named synthetic test databases, ignore `.env` and require a local PostgreSQL account allowed to create databases. `test:database` runs fixtures against its configured database: use an empty disposable target, never the populated owner database. See [persistence](../architecture/persistence.md) for migration and guard constraints.

Runtime instructions, port/profile options and toolchain pins are in the [Solana toolchain runbook](../development/toolchain.md). The integration harness uses disposable keys and ledgers; Devnet profile selects artifacts rather than a remote network. A retained-to-candidate loader upgrade is tested using the [owner upgrade package procedure](../deployment/owner-localnet-program-upgrade.md), preserving the original owner environment.

Inside the supported WSL toolchain, run:

```bash
cargo +1.98.1 fmt --all -- --check
cargo +1.98.1 test -p lifecycle_kase --locked
cargo +1.98.1 test -p lifecycle_kase --locked --features devnet
cargo +1.98.1 clippy -p lifecycle_kase --all-targets --locked -- -D warnings
cargo +1.98.1 clippy -p lifecycle_kase --all-targets --locked --features devnet -- -D warnings
```

Host tests do not replace SBF compilation or validator execution. The isolated legacy Anchor/web3 integration dependency graph has 12 known advisories at the prior audit; it must remain restricted to trusted disposable local RPC and excluded from Render/root dependencies until replaced.

## Critical acceptance assertions

- Authentication: wrong Origin, replay, expired/revoked session, Auditor write and non-issuer operation are rejected server-side.
- Transactions: wrong network/signer, changed message, expired unsigned plan, ambiguous broadcast, finalized failure and missing historical bytes cannot produce false success.
- Persistence: concurrency/version conflicts, audit failure and tampered snapshot/calculation roll back atomically; confirmation is idempotent.
- Chain: exact prepared finalized wire, correct account owner/PDA/mints, slot floor, supply/balances/counters and expected deltas match before a projection changes.
- Settlement when implemented: payment/burn/receipt update is atomic, double execution is rejected, incomplete/mismatched Cash/Asset Legs block finalization, and post-snapshot transfer cannot pay without the required burn.

Add regression tests for meaningful bugs at the layer that exposes their cause. Prefer behavioral assertions; a test that merely copies implementation logic or matches source text cannot prove a financial workflow.

## CI coverage and unfinished acceptance

[GitHub CI](../../.github/workflows/ci.yml) runs full-history secret scanning, Rustfmt/tests/Clippy for both profiles, clean service-order web build, repository checks, deployed dependency audit, workspace builds, proxy/Compose checks and disposable PostgreSQL suites. Documentation validation requires the data-flow, security and testing documents to remain present.

Separate pending gates: JS lint/format tooling, SBF/runtime validator CI, complete browser Administrator/Auditor routes and error/reload cases, persistent owner entitlement upgrade/registration/funding, governed coupon payout, early/maturity redemption, receipts/reconciliation, restart/reindex and public Devnet acceptance. See the [delivery checklist](../deployment/DEVNET_TO_MVP_CHECKLIST.md). Existing screenshots, CI health and disposable tests do not close these gates.

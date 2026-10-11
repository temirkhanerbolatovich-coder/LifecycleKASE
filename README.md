# LifecycleKASE

English reviewers: start with the [reviewer guide](docs/submission/JUDGE_README.md) or [public walletless QA](https://lifecyclekase-web.onrender.com/qa). The **2026-10-11 application release** adds RU/EN UI and fixes wallet-session invalidation and zero-rounded coupons. API and web are Live at `1e6c96dd119f32cbf01cecef028723b9134ebe4b`; all three CI jobs, public health/protected routes and the browser QA coupon scenario passed. See [deployment evidence](docs/deployment/render-staging.md) and [acceptance and remaining submission gates](docs/testing/submission-readiness-2026-10-11.md). QA is a per-page simulation; retained-owner and public-network financial acceptance are separate.

Initial audit checkpoint — **2026-10-11**, before the implementation above: [full findings and prioritized backlog](docs/PROJECT_AUDIT_2026-10-11.md). Fresh checks pass 330 Node tests, workspace types/builds, production proxy and both 18-test Rust profiles. Two confirmed defects remain: revoked operator-wallet sessions and mixed zero/positive coupon registration. Local QA browser flows pass; public `/qa` currently returns 404. See the [UI/UX results](docs/testing/ui-ux-audit-2026-10-11.md), [RU/KK/EN plan](docs/features/localization-plan.md) and [English demo/pitch scripts](docs/submission/ENGLISH_DEMO_AND_PITCH_PLAN.md). No code fix, deployment or submission was performed in this audit.

The following October 10 paragraph is the preceding candidate implementation checkpoint; today's findings and checks are linked above.

Current development: **2026-10-10** — 320 Node tests, production web build and both Rust profiles pass. The isolated default-off candidate adds [atomic partial/maturity redemption](docs/features/redemption-execution-and-receipts.md), immutable source/supply proof, exact-wire API/UI recovery and receipts. Runtime acceptance status is in [three-action verification](docs/testing/kase-three-actions-2026-10-10.md); owner rollout and public-network evidence remain separate. See the [audit checkpoint](docs/PROJECT_AUDIT_2026-10-10.md), [delivery plan](docs/deployment/DEVNET_TO_MVP_CHECKLIST.md) and [submission overview](docs/submission/TECHNICAL_OVERVIEW.md).

Run `npm run demo:verify` with Docker and the documented non-root WSL toolchain to build a fresh candidate and verify coupon → partial 20% → maturity on a disposable validator/database. Use `npm run demo:verify -- -Profile localnet-candidate-redemption-20261010` to reuse an existing candidate. This never uses the retained owner signer/ledger. KZT-Test/eligibility are simulated; transfers, burns and Solana receipts are executed.

Submission preparation — **2026-10-11**: the [submission package](docs/submission/README.md) includes an English-captioned Auditor demo, a [current requirements matrix](docs/submission/KASE_REQUIREMENTS_MATRIX.md), a [ready-to-paste form draft](docs/submission/COLLOSSEUM_SUBMISSION.md), three exact canonical receipts and run evidence. Main Colosseum registration/stages are owner-confirmed; the owner confirms that project submission has not yet occurred. Main and side-track submissions remain. Planned record date opens the capture window; the ownership cutoff is actual finalized capture slot/time.

Earlier public application staging — **2026-10-11, before the QA release**: [open LifecycleKASE](https://lifecyclekase-web.onrender.com/dashboard). Both existing Render services were Live at `bc62abfd947db6bc854624dccdcac61ec13036a3`; migration 19, public health/readiness, the dashboard and protected transaction routes were verified. Wallet login requires a registered operator. Render cannot reach the owner's loopback validator; authenticated signing and financial execution were not rerun. The Localnet badge does not prove a cloud chain connection. See the [deployment evidence and limits](docs/deployment/render-staging.md).

Walletless UI QA: `/qa` reuses the operator workspace with page-local synthetic records, issuer/approver/Auditor identities and simulated coupon/redemption stages. Reload or reset starts fresh data; export marked QA JSON with a findings report. The real dashboard keeps wallet authentication. See the [QA instructions, checklist and limits](docs/features/qa-sandbox.md); QA implementation/deployment validation is recorded separately from the staging checkpoint above.

## Earlier owner and engineering checkpoints

The dated observations below are retained history. Current candidate implementation/runtime evidence is linked above; they do not describe its newer redemption completion.

October 10 engineering continuation: [atomic coupon execution and receipts](docs/features/coupon-execution-and-receipts.md) adds exact approved-vault transfers, per-entitlement replay protection, finalized Cash/Asset Leg reconciliation and a canonical JSON ActionReceipt hash. The Localnet candidate is isolated and execution defaults off; retained owner acceptance remains separate. [Workspace modernization](docs/features/operator-workspace-ui.md) removes repeated overview/technical noise, keeps the current step visible on mobile and adds authenticated Transactions/Audit journals. See [coupon acceptance](docs/testing/coupon-execution-2026-10-10.md) for current evidence and remaining boundaries.

Corporate actions now include a [guarded missed-snapshot check](docs/features/corporate-actions.md#missed-snapshot-window): finalized Clock/PDA evidence, atomic application `SNAPSHOT_MISSED` and audit, preserved signed/captured recovery and a clear dashboard next step. No ledger reset, program change, schema migration or background worker is required.

[Separate approver and action reserve](docs/features/action-approval-and-reserve.md) is implemented in a new isolated Localnet candidate: immutable distinct authority, whole-coupon Token-2022 custody, pre-approval refund and exact finalized approval/database/audit. The capability defaults off. Owner rollout remains a separate gate; coupon payout/receipt now pass the isolated October 10 acceptance, linked above; the held owner FINALIZE is preserved. See [acceptance](docs/testing/action-approval-reserve-2026-10-09.md).

[Localnet program upgrade maintenance](docs/features/program-upgrade-maintenance.md) provides restricted Phantom EXTEND/UPGRADE plans, durable attempts/audit, recovery and a persistent business-write lock. It defaults to disabled. On 2026-10-09 both owner Phantom phases finalized on the preserved Localnet, the pinned candidate hash was read back, the authority and existing Action PDA were preserved, and the maintenance lock was released as `VERIFIED`. Subsequent owner partial REGISTER, RESET and all three REGISTER are accepted; expired signed FINALIZE remains UNKNOWN_CONFIRMATION for checking at the owner's request. See [owner entitlement evidence](docs/testing/owner-entitlements-2026-10-09.md).

[Administrator Telegram monitoring](docs/features/telegram-monitoring.md) adds a separate outbound watchdog for published API/web readiness and owner Localnet identity/progress, optional read-only operation aggregates, hourly summaries, and problem/recovery alerts. Run `npm run monitor:telegram -- --check` for a no-send report. The administrator confirmed the initial Telegram summary on 2026-10-08. Supervised startup and repeatable live owner-database/Localnet aggregate acceptance remain pending.

The dashboard includes [corporate actions and snapshot](docs/features/corporate-actions.md), [stored entitlements/review](docs/features/entitlements-and-review.md), [Localnet coupon budget/funding](docs/features/coupon-funding.md), and guarded [on-chain entitlement registration](docs/features/on-chain-entitlement-registration.md). Persistent owner Phantom issuance and the coupon snapshot are accepted; its 1750 KZT-Test calculation is UNDER_REVIEW and an unsigned treasury funding plan is prepared. Funding passed isolated real-validator/HTTP/PostgreSQL acceptance; owner funding signing remains pending. Localnet transactions use exact wallet-signing/API broadcast/finalized reconciliation. Coupon payments and receipts pass isolated acceptance in the new candidate; owner payments/redemption remain pending; candidate burns are implemented and verified separately. See the [current full audit](docs/PROJECT_AUDIT_2026-10-10.md) for verified boundaries and priorities.

Corporate Action Engine for tokenized securities on Solana. The repository includes requirements/ADRs, CI, guarded PostgreSQL migrations, shared Rust/TypeScript financial vectors, authenticated wallet workflows, stored entitlements/review, and the upgraded owner program with entitlement registration/reset/finalization instructions. [Investor Registry](docs/features/investor-registry.md) and [four-phase issuance](docs/features/instrument-drafts.md) support the accepted Localnet LKA26R1 demo. The candidate's old→new loader upgrade and existing-PDA compatibility passed both disposable testing and the [retained owner upgrade](docs/deployment/owner-localnet-program-upgrade.md). Full corporate-action execution/acceptance is incomplete. The owner approved local MVP first; public Devnet deployment stays deferred until MVP approval, and mainnet/real assets are excluded under [ADR-014](docs/decisions/ADR-014-local-mvp-before-public-network.md). Signing boundaries require explicit Localnet/Devnet plans; Localnet verifies exact signed bytes before API broadcast. Remaining entitlement-finalization, manual negative and payment/redemption scenarios are separate gates.

## Scope

The MVP demonstrates an end-to-end lifecycle for a fixed-supply tokenized bond:

- issuance of 35 indivisible Token-2022 tokens;
- three investors with balances of 10, 20, and 5 tokens, each potentially using several wallets;
- coupon, early-redemption, and maturity-redemption corporate actions;
- finalized-slot snapshots with deterministic calculation;
- review and approval, atomic KZT-Test payment and burn legs, reconciliation, and receipts per entitlement and action.

The binding requirements are:

- [Product requirements](docs/requirements/PRODUCT_REQUIREMENTS.md)
- [Technical requirements](docs/requirements/TECHNICAL_REQUIREMENTS.md)
- [Solana toolchain setup](docs/development/toolchain.md)
- [Domain contracts and test vectors](docs/testing/domain-contracts.md)
- [Persistence architecture](docs/architecture/persistence.md)
- [Data flow and evidence boundaries](docs/architecture/data-flow.md)
- [Security model and remaining controls](docs/security/security-model.md)
- [Security reporting policy](SECURITY.md)
- [Contribution and validation workflow](CONTRIBUTING.md)
- [Testing strategy and acceptance levels](docs/testing/testing-strategy.md)
- [Implemented, simulated, and pending scope](docs/IMPLEMENTED_VS_SIMULATED.md)
- [KASE side-track compliance checklist](docs/KASE_COMPLIANCE_CHECKLIST.md)
- [Current full project audit](docs/PROJECT_AUDIT_2026-10-10.md)
- [Disposable Render staging deployment](docs/deployment/render-staging.md)
- [Ordered Devnet-to-MVP checklist and read-only preflight](docs/deployment/DEVNET_TO_MVP_CHECKLIST.md)
- [Owner Localnet upgrade package and read-only program preflight](docs/deployment/owner-localnet-program-upgrade.md)

## Repository layout

```text
apps/                 Internal API preparation service, health HTTP layer, and status web app
packages/             Shared domain contracts and Token-2022 holder collector
programs/             Anchor instrument, action, and snapshot-commitment instructions
prisma/               PostgreSQL schema and guarded migrations
docs/architecture/    Current system boundaries
docs/decisions/       Accepted architecture decisions
docs/requirements/    Product and technical requirements
scripts/              Repeatable validation and local smoke tests
test/                 Repository-level tests
```

Implementation boundaries and limitations are documented in each component README.

## Requirements

- Node.js 22 or newer;
- npm 10 or newer;
- Docker with Compose for local PostgreSQL;
- Rust, Solana CLI, and Anchor CLI for on-chain development.

Run the environment check:

```powershell
npm run check:toolchain
```

## Setup and validation

```powershell
npm install
npm run build:web
npm run check
docker compose up -d postgres
npm run prisma:migrate:deploy
npm run test:database
npm run test:api:database
npm run test:registry:database
```

Copy `.env.example` to `.env` only when local services need configuration. `.env` is ignored by Git.

To run the status slice locally, start PostgreSQL and apply migrations as above, then use two terminals:

```powershell
npm run build --workspace @lifecycle-kase/api
npm run start:api
```

```powershell
npm run dev:web
```

Open `http://localhost:3000/dashboard`. The API listens on port `4000` by default and exposes health plus operator authentication routes. Authentication requires `AUTH_ENABLED=true`, exact `AUTH_DOMAIN`/`AUTH_ALLOWED_ORIGINS`, and a verified operator wallet in the database; see [API documentation](apps/api/README.md) and the [controlled provisioning runbook](docs/operations/operator-provisioning.md). Challenge, signature verification and protected mutation endpoints have bounded per-client in-memory limits with configurable windows. Readiness checks PostgreSQL and returns 503 when unavailable. The web app checks it server-side using `API_INTERNAL_URL` (default `http://127.0.0.1:4000`); it still renders when the API is down. For a deployment, set `DATABASE_URL`, `PORT` and `API_SERVER_URL` for that environment; the Render Blueprint wires the URL automatically. Never expose database credentials in `NEXT_PUBLIC_*` variables. The web liveness route is `GET /health/live`.

PostgreSQL is exposed only on IPv4/IPv6 loopback host port `55432` by default to avoid collisions with an existing local PostgreSQL installation; the container still listens on its standard internal port `5432`. The default host URL uses IPv6 loopback `[::1]`, which avoids an IPv4 PostgreSQL service intercepting Docker Desktop traffic on Windows. Set `API_LISTEN_HOST=127.0.0.1` for a local-only API; when unset, the hosted-service default remains `0.0.0.0`.

The registry database test ignores `.env`, requires local database CREATE DATABASE permission, and creates/migrates/drops only a uniquely named test database. It exercises real HTTP authentication, role/Origin controls, registry persistence, concurrency, rollback, audit immutability and logout using synthetic in-memory signing keys. See [test configuration and limits](docs/features/investor-registry.md). Owner-reported local Phantom login/profile/registry display passed; manual browser form acceptance and public network acceptance are separate pending checks.

To verify a locally installed Solana validator:

```powershell
npm run solana:smoke
```

The smoke test starts an isolated validator on port `18899`, waits for a JSON-RPC response, and always stops the process and removes its temporary ledger. It fails with an actionable message when `solana-test-validator` is not installed.

## Current limitations

- The API supports domain-bound operator wallet authentication and administrator-only preparation/confirmation routes. The dashboard discovers Wallet Standard wallets and includes Localnet/Devnet snapshot review, explicit sign/send and finalized-confirm/recovery. The requested chain comes from the validated API plan, while cluster/wallet-network mismatches fail closed. A controlled CLI can create the first operator from a public wallet address, and authentication requests are rate-limited per client. See the [wallet workflow and recovery limits](apps/web/README.md). Instrument issuance and the new coupon snapshot passed live Phantom/Localnet acceptance. Owner treasury funding and payment acceptance remain pending. Public Devnet proof remains deferred. The owner accepted local signed Administrator and Auditor login flows; disposable staging has only challenge and unauthenticated-denial evidence. See the [deployment record](docs/deployment/render-staging.md).
- Nineteen SQL migrations and database guard tests are implemented. The third migration requires an empty pre-MVP domain database; it stops when domain records exist. Later migrations add Localnet compatibility, authentication separation, eligibility/revocation audit rules, persisted issuance/action/funding attempts, exact-wire constraints, a single unresolved coupon funding attempt per issuer and durable program-upgrade maintenance. All 19 are applied to the persistent local acceptance database; staging migration state is separate.
- TypeScript domain contracts and matching checked Rust calculations pass shared financial vectors. The retained owner program includes entitlement registration/reset/finalization after the verified upgrade; RESET and all three owner registrations are accepted. The held FINALIZE, approval, execution and receipts remain pending.
- The validator smoke-test requires an external Solana CLI installation.
- Docker Compose currently provisions PostgreSQL only; application containers will be added with their implementation milestone.
- No production deployment, key custody, or real-money operation is supported.
- The operator application is publicly deployed as disposable staging at <https://lifecyclekase-web.onrender.com/dashboard>; access requires a registered operator wallet. The recorded deployment does not prove authenticated financial execution or connectivity to the owner's loopback validator. Its free PostgreSQL has a short lifetime and no backups; do not store real data there. See the [deployment record](docs/deployment/render-staging.md).

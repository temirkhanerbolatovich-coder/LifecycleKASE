# LifecycleKASE

LifecycleKASE is an operator terminal and Solana program for servicing test tokenized bonds after issuance: capture holders, calculate entitlements, obtain separate approval and a full reserve, execute coupon or redemption, reconcile finalized evidence and commit the receipt hash on-chain. It is a hackathon prototype and is not affiliated with or approved by KASE.

English reviewers: start with the [reviewer guide](docs/submission/JUDGE_README.md), [requirements matrix](docs/submission/KASE_REQUIREMENTS_MATRIX.md) and [submission package](docs/submission/README.md). The [public walletless QA](https://lifecyclekase.assetguard-temirkhan.duckdns.org/qa) demonstrates synthetic interface workflows. The [operator dashboard](https://lifecyclekase.assetguard-temirkhan.duckdns.org/dashboard) requires a registered wallet. Current hosted source is `f51be25` on the owner's existing Oracle VPS: public QA/English hydration and API readiness passed on 2026-10-12, with 23 migrations in a new isolated database and protected routes returning 401/no-store. Financial capabilities remain disabled. Docker/systemd run the website independently of this chat; see [current hosting and limits](docs/deployment/oracle-duckdns.md). Older Render observations remain [historical staging evidence](docs/deployment/render-staging.md).

## Current source and verified scope

The judge package is published on `master` after [PR #1](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/pull/1) and successful PR/master CI. The latest [publication and hosting follow-up](docs/submission/PUBLICATION_2026-10-12.md) records the active VPS update/recovery; the earlier successful hosted observations above remain dated evidence.

Submission preparation snapshot: **2026-10-12**, implementation source [`f51be25`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/f51be252295af181ed931f00dba1ee89c35aedef). The [current checklist](docs/submission/SUBMISSION_CHECKLIST_2026-10-12.md) separates completed implementation, saved runtime evidence and remaining submission steps. Documentation edits do not constitute another financial run.

The accepted controlled instrument v2 workflow uses a new default-frozen Token-2022 mint, authorized transfers, locked raw holder capture and reservation of only assigned redemption units. Authenticated API/PostgreSQL/Localnet acceptance completed on **2026-10-12 at 14:19:06 Asia/Qyzylorda**:

| Action | Payment, KZT-Test | Bonds burned | Supply |
| --- | ---: | ---: | --- |
| Coupon | 1,750 | 0 | 35 → 35 |
| Percentage partial redemption, 20% | 7,000 | 7 | 35 → 28 |
| Exact-target partial redemption, 8 units | 8,000 | 8 | 28 → 20 |
| Maturity, principal plus final coupon | 21,000 | 20 | 20 → 0 |

Exact partial allocation is **2/5/1** from captured holdings **8/16/4**. Every action finalized its canonical receipt; cash/burn evidence and database projection reconciled. The run also verified original-signature recovery after a finalized burn and source-account closure, and unchanged historical redemption receipts after maturity. [Runtime, four canonical receipts and fingerprints](docs/testing/evidence/controlled-workflow-2026-10-12/README.md) identify the exact accepted source/helpers/binary. KZT-Test, eligibility, generated test signers and accelerated maturity are synthetic inputs; transfers and burns execute on a real disposable validator.

The subsequent [operator continuation](docs/testing/operator-continuation-2026-10-12.md) implements a [six-step action master](docs/features/operator-action-master.md), authenticated [JSON/CSV evidence export](docs/features/action-evidence-export.md), [full-database overview](docs/features/operator-overview.md) and a default-off [original-signature reconciliation worker](docs/features/durable-reconciliation.md). Its recorded validation passed **684 Node tests**, types, Prisma, production build/proxy and disposable PostgreSQL acceptance with **23 migrations**, including 10,000 synthetic actions and 10,000 investors. Fresh chain recovery by the new worker and authenticated export download against fresh settlement remain open; the earlier four-action runtime is not presented as a test of those additions.

## Implemented and limited behavior

- Administrator/Auditor wallet sessions, one-time ownership proof, verified multi-wallet investor registry, governed profile/eligibility corrections, temporary wallet blocking, server search, direct profile links and complete wallet pages.
- Legacy and controlled v2 issuance, finalized immutable snapshots, integer coupon/maturity/percentage/exact-target formulas, review, separate approval and full action-vault reserve.
- Atomic Token-2022 payment/burn, replay protection, saved exact transaction attempts, confirmation through the original signature, canonical JSON receipt/PDA commitment and audited evidence access.
- Responsive RU/EN operator terminal with preserved signing/form state, six action stages, transactions/audit journals, complete database aggregates and evidence export.

The effective holder cutoff is the actual finalized capture slot/time. A planned record time opens the capture window; arbitrary historical ownership is not reconstructed. Controlled v2 prevents direct transfer/burn/approval bypass and locks holdings during capture. Legacy mints retain their original unrestricted token policy; they cannot acquire v2 extensions retroactively.

Controlled registry, exact-target redemption and the reconciliation worker default off and require explicit configuration and a compatible reviewed Localnet candidate. The retained owner environment, hosted application and disposable evidence environments have separate acceptance. Real KYC/fiat, KASE/CSD integration, public Devnet/Mainnet financial acceptance, issuer tenant isolation, general secondary transfer UI, multi-instrument settlement-mint reuse, period-level coupon uniqueness and full manual accessibility/usability acceptance remain open. See [implemented versus simulated](docs/IMPLEMENTED_VS_SIMULATED.md) and the [BondFlow implementation plan](docs/features/bondflow-implementation-plan.md).

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js operator interface and fixed same-origin API proxy |
| `apps/api` | NestJS authentication, application workflows and finalized reconciliation |
| `packages/domain` | Integer formulas, snapshots and financial contracts |
| `packages/solana-client` | Exact transaction builders, account/receipt decoders |
| `programs/lifecycle_kase` | Anchor/Token-2022 program |
| `prisma` | Schema, reviewed migrations and database guards |
| `scripts` / `test` | Isolated acceptance, evidence verification and repository checks |
| `docs` | Requirements, architecture, security, features, validation and submission |

## Setup and validation

Use **Node.js 22+**. Docker Desktop/PostgreSQL are needed for database acceptance. Runtime reproduction additionally requires the documented [non-root WSL Solana/Anchor toolchain](docs/development/toolchain.md).

```powershell
npm ci
npm run build:web
npm run check
npm run build
npm run test:web:proxy
npm audit --omit=dev
```

For a local interface-only review:

```powershell
npm run dev:web
# Open http://localhost:3000/qa and select English.
```

For local authenticated services, copy the ignored `.env.example` to `.env`, configure it, then start PostgreSQL and migrations:

```powershell
docker compose up -d postgres
npm run prisma:migrate:deploy
npm run build --workspace @lifecycle-kase/api
npm run start:api
```

In another terminal run `npm run dev:web`; open `http://localhost:3000/dashboard`. The API defaults to port 4000. Authentication requires `AUTH_ENABLED=true`, exact domain/allowed Origins and a provisioned verified operator wallet; follow the [API README](apps/api/README.md) and [provisioning runbook](docs/operations/operator-provisioning.md). Never place secrets in `NEXT_PUBLIC_*` variables.

Compose PostgreSQL defaults to loopback host port **55432**, internal port 5432; the example host URL uses IPv6 loopback to avoid Windows service interception. `API_LISTEN_HOST=127.0.0.1` restricts a local API. Hosted readiness checks PostgreSQL; web liveness is `GET /health/live`.

Reproduce the accepted controlled financial flow using invocation-owned disposable resources:

```powershell
npm run test:controlled:workflow
```

After building helpers, verify saved evidence without RPC/database access:

```powershell
npm run controlled:evidence:verify -- docs/testing/evidence/controlled-workflow-2026-10-12/runtime.json
```

The legacy/exact-target harness remains `npm run demo:verify`; it uses a distinct financial fixture. Neither harness imports the owner's ledger, wallet keys or `.env`. The [testing strategy](docs/testing/testing-strategy.md) describes each check's scope. The third migration requires an empty pre-MVP domain database; do not apply destructive test scripts to retained owner data.

## Documentation and delivery

Read [product requirements](docs/requirements/PRODUCT_REQUIREMENTS.md), [technical requirements](docs/requirements/TECHNICAL_REQUIREMENTS.md), [BondFlow extension requirements](docs/requirements/KASE_BondFlow_TZ.md), [architecture](docs/architecture/overview.md), [data flow](docs/architecture/data-flow.md), [persistence](docs/architecture/persistence.md), [security model](docs/security/security-model.md), [security policy](SECURITY.md) and [contribution workflow](CONTRIBUTING.md).

The current judge package maps the official contest brief separately from the larger product specification. Completed local English videos: [pitch — 115.104 seconds](docs/submission/lifecyclekase-pitch-en-benjamin.mp4) and [live QA interface demo — 164.964 seconds](docs/submission/lifecyclekase-demo-en-benjamin.mp4), with disclosed synthetic English narration. The demo's financial operations are simulated; saved Localnet evidence is separately identified. [Media validation and remaining upload](docs/submission/ENGLISH_DEMO_AND_PITCH_PLAN.md) records measured scope. Accepted-host upload (YouTube/Loom/Vimeo) and final main/side-track submit remain open. Main registration was owner-confirmed; final project submission is complete only when organizer confirmation and public URLs are recorded. Historical audits and media retain their own dates, source pins and environment limits.
